// llm-proxy.js - LLM HTTP proxying in the Electron MAIN process.
//
// Why: the OpenRouter API key is stored via safeStorage in the main process.
// If the renderer performed the fetch itself it would have to receive the raw
// key, exposing it to any renderer-side XSS. All LLM/Vision requests therefore
// go through here; the key never crosses the IPC boundary.
//
// Security:
// - Endpoint allowlist replaces the renderer CSP (which no longer applies to
//   fetches originating here). Only the origins the renderer CSP allowed can
//   be reached: local Ollama + OpenRouter + z.ai.
// - Payload validation + size caps (defuse memory bombs / odd shapes).
// - Streaming responses are forwarded as text chunks via the injected `send`
//   callback; callers must route them back to the requesting renderer.
//
// Pure Node (no Electron imports) so it can be unit-tested directly.

const LLM_ALLOWED_ORIGINS = new Set([
  "http://localhost:11434",
  "https://openrouter.ai",
  "https://api.openrouter.ai",
  "https://api.z.ai",
]);

const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 64 * 1024;
const MAX_VISION_PARTS = 10;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_DETAIL_CHARS = 500;
const MAX_HEADER_CHARS = 500;

/** @type {Map<string, AbortController>} in-flight requests by reqId */
const requests = new Map();
/** reqIds aborted by the renderer before the request was registered */
const abortedEarly = new Set();

/**
 * Add an extra allowed origin. Production code never calls this — it exists
 * so tests can point the proxy at a local test server. The renderer cannot
 * influence the allowlist (it is not part of the request payload).
 * @param {string} origin e.g. "http://127.0.0.1:41234"
 */
function addLLMAllowedOrigin(origin) {
  if (typeof origin === "string" && origin) LLM_ALLOWED_ORIGINS.add(origin);
}

/**
 * @param {string} raw
 * @returns {boolean} whether the endpoint is on the allowlist
 */
function isAllowedLLMEndpoint(raw) {
  if (typeof raw !== "string" || !raw) return false;
  try {
    return LLM_ALLOWED_ORIGINS.has(new URL(raw).origin);
  } catch {
    return false;
  }
}

/**
 * Abort an in-flight (or about-to-start) request.
 * @param {string} reqId
 */
function abortLLM(reqId) {
  if (typeof reqId !== "string" || !reqId) return;
  const controller = requests.get(reqId);
  if (controller) {
    controller.abort();
  } else {
    abortedEarly.add(reqId);
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "messages fehlen oder sind leer.";
  }
  if (messages.length > MAX_MESSAGES) {
    return `zu viele Nachrichten (max ${MAX_MESSAGES}).`;
  }
  for (const m of messages) {
    if (!m || typeof m.role !== "string" || !m.role) return "Nachricht ohne role.";
    const content = m.content;
    if (typeof content === "string") {
      if (content.length > MAX_MESSAGE_CHARS) {
        return `Nachricht zu groß (max ${MAX_MESSAGE_CHARS} Zeichen).`;
      }
      continue;
    }
    // Vision format: content is an array of text/image_url parts.
    if (Array.isArray(content)) {
      if (content.length === 0 || content.length > MAX_VISION_PARTS) {
        return `Nachricht hat ungültige Vision-Teile (max ${MAX_VISION_PARTS}).`;
      }
      for (const part of content) {
        if (!part || typeof part.type !== "string" || !part.type) {
          return "Vision-Teil ohne type.";
        }
      }
      continue;
    }
    return "Nachricht content ist weder Text noch Vision-Array.";
  }
  return null;
}

/**
 * Run one LLM request. Resolves with a result object; for streaming requests
 * each decoded text chunk is pushed through `send("llm:chunk", {reqId, chunk})`
 * and completion through `send("llm:done", {reqId})`.
 *
 * @param {object} opts
 * @param {string} opts.reqId            client-generated correlation id
 * @param {string} opts.provider         "openrouter" | "ollama" | other
 * @param {string} opts.endpoint         must be allowlisted
 * @param {string} opts.model
 * @param {Array<{role: string, content: string|Array}>} opts.messages
 * @param {Array} [opts.tools]           OpenAI tools array
 * @param {string} [opts.toolChoice]
 * @param {boolean} [opts.stream]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.referer]        OpenRouter header (non-secret)
 * @param {string} [opts.title]          OpenRouter header (non-secret)
 * @param {string} [opts.apiKey]         OpenRouter key (from safeStorage)
 * @param {(channel: string, payload: object) => void} opts.send
 * @returns {Promise<{ok: boolean, data?: any, status?: number, statusText?: string, detail?: string, error?: string, aborted?: boolean}>}
 */
async function runLLMRequest(opts) {
  const {
    reqId,
    provider,
    endpoint,
    model,
    messages,
    tools,
    toolChoice,
    stream,
    temperature,
    maxTokens,
    referer,
    title,
    apiKey,
    send,
  } = opts || {};

  if (typeof reqId !== "string" || !reqId) {
    return { ok: false, error: "reqId fehlt." };
  }
  if (!isAllowedLLMEndpoint(endpoint)) {
    return { ok: false, error: "LLM-Endpunkt ist nicht erlaubt (Allowlist)." };
  }
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, error: "model fehlt." };
  }
  const msgErr = validateMessages(messages);
  if (msgErr) return { ok: false, error: msgErr };

  const body = {
    model,
    messages,
    stream: Boolean(stream),
    temperature,
    max_tokens: maxTokens,
  };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }

  let bodyText;
  try {
    bodyText = JSON.stringify(body);
  } catch {
    return { ok: false, error: "Payload nicht serialisierbar." };
  }
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return { ok: false, error: `Payload zu groß (max ${MAX_BODY_BYTES / 1024} KB).` };
  }

  const headers = { "Content-Type": "application/json" };
  if (provider === "openrouter") {
    const key = typeof apiKey === "string" && apiKey ? apiKey : "";
    if (!key) {
      return {
        ok: false,
        error: "Fehlender API-Key für OpenRouter. Bitte unter Einstellungen eintragen.",
      };
    }
    headers["Authorization"] = `Bearer ${key}`;
    if (typeof referer === "string" && referer)
      headers["HTTP-Referer"] = referer.slice(0, MAX_HEADER_CHARS);
    if (typeof title === "string" && title) headers["X-Title"] = title.slice(0, MAX_HEADER_CHARS);
  }

  const controller = new AbortController();
  requests.set(reqId, controller);
  if (abortedEarly.has(reqId)) {
    abortedEarly.delete(reqId);
    controller.abort();
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: bodyText,
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, MAX_DETAIL_CHARS);
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, statusText: res.statusText, detail };
    }

    if (body.stream) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let aborted = false;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text && typeof send === "function") {
            send("llm:chunk", { reqId, chunk: text });
          }
        }
      } catch (err) {
        if (err.name === "AbortError") aborted = true;
        else throw err;
      } finally {
        try {
          reader.releaseLock?.();
        } catch {
          /* ignore */
        }
      }
      if (aborted) return { ok: false, aborted: true };
      if (typeof send === "function") send("llm:done", { reqId });
      return { ok: true };
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 200000) };
    }
    return { ok: true, data };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, aborted: true };
    return { ok: false, error: (err && err.message) || String(err) };
  } finally {
    requests.delete(reqId);
    abortedEarly.delete(reqId);
  }
}

module.exports = { runLLMRequest, abortLLM, isAllowedLLMEndpoint, addLLMAllowedOrigin };
