// lib/llm-proxy.js - Renderer-side wrapper for LLM requests.
//
// Requests run in the Electron MAIN process (backend/src/llm-proxy.js) so the
// OpenRouter API key stored in safeStorage never reaches the renderer.
//
// If window.electronAPI is unavailable (opening index.html directly in a plain
// browser, tests), this falls back to a direct fetch using the key from the
// settings input — identical to the pre-proxy behavior.

function hasLLMProxy() {
  return (
    typeof window !== "undefined" &&
    !!window.electronAPI &&
    typeof window.electronAPI.chatLLM === "function"
  );
}

function makeReqId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "llm" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function describeHttpStatus(status) {
  if (status === 401) return "API Fehler 401: Ungültiger API-Key.";
  if (status === 403) return "API Fehler 403: Zugriff verweigert.";
  if (status === 429) return "API Fehler 429: Rate-Limit überschritten.";
  if (status >= 500) return `API Fehler ${status}: Server-Fehler beim Anbieter.`;
  return `API Fehler ${status}`;
}

function proxyErrorFromResult(result) {
  if (result && result.aborted) {
    const err = new Error("LLM-Anfrage abgebrochen.");
    err.name = "AbortError";
    return err;
  }
  if (result && result.status) {
    const err = new Error(describeHttpStatus(result.status));
    err.status = result.status;
    return err;
  }
  return new Error((result && result.error) || "LLM-Anfrage fehlgeschlagen.");
}

/**
 * Query whether a secure API key is stored (main process).
 * @returns {Promise<{hasKey: boolean, hint: string}>}
 */
export function getLLMKeyStatus() {
  if (hasLLMProxy() && typeof window.electronAPI.getApiKeyStatus === "function") {
    return window.electronAPI.getApiKeyStatus().catch(() => ({ hasKey: false, hint: "" }));
  }
  // Browser fallback: the input itself is the storage.
  const key = document.getElementById("ai-api-key")?.value || "";
  return Promise.resolve({ hasKey: Boolean(key), hint: key ? "••••" : "" });
}

/**
 * Non-streaming LLM request.
 * @param {object} payload provider/endpoint/model/messages/stream/temperature/maxTokens/referer/title/signal
 * @returns {Promise<{ok: boolean, data?: any, status?: number, statusText?: string, detail?: string, error?: string, aborted?: boolean}>}
 */
export async function chatLLM(payload) {
  const reqId = makeReqId();
  if (hasLLMProxy()) {
    const signal = payload.signal;
    const rest = { ...payload };
    delete rest.signal;
    if (signal && typeof signal.addEventListener === "function") {
      const onAbort = () => {
        if (window.electronAPI.abortLLM) window.electronAPI.abortLLM(reqId);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        return await window.electronAPI.chatLLM({ ...rest, reqId });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    return window.electronAPI.chatLLM({ ...rest, reqId });
  }
  return directFetch(payload);
}

/**
 * Streaming LLM request. In proxy mode the main process forwards decoded text
 * chunks to `onChunk`; the promise settles on llm:done or on the invoke
 * result. In browser fallback mode the fetch + stream loop runs here.
 *
 * @param {object} payload provider/endpoint/model/messages/tools/toolChoice/temperature/maxTokens/referer/title
 * @param {{signal?: AbortSignal, onChunk: (text: string) => void}} io
 * @returns {Promise<void>} rejects with AbortError on abort
 */
export function streamChatLLM(payload, { signal, onChunk }) {
  if (!hasLLMProxy()) return directStreamFetch(payload, { signal, onChunk });

  return new Promise((resolve, reject) => {
    const reqId = makeReqId();
    let settled = false;
    let graceTimer = null;

    const cleanup = () => {
      unsubscribeChunk();
      unsubscribeDone();
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      cleanup();
      fn(arg);
    };

    const unsubscribeChunk = window.electronAPI.onLLMChunk((evt) => {
      if (evt && evt.reqId === reqId && typeof evt.chunk === "string") {
        onChunk(evt.chunk);
      }
    });
    const unsubscribeDone = window.electronAPI.onLLMDone((evt) => {
      if (evt && evt.reqId === reqId) settle(resolve, evt);
    });
    const onAbort = () => {
      if (window.electronAPI.abortLLM) window.electronAPI.abortLLM(reqId);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    window.electronAPI
      .chatLLM({ ...payload, stream: true, reqId })
      .then((result) => {
        if (settled) return;
        if (result && !result.ok) {
          settle(reject, proxyErrorFromResult(result));
          return;
        }
        // ok:true — llm:done event follows; settle on it. Grace timer covers
        // any pathological event/invoke ordering in future Electron versions.
        graceTimer = setTimeout(() => settle(resolve, {}), 1500);
      })
      .catch((err) => {
        if (!settled) settle(reject, err);
      });
  });
}

// ---------------------------------------------------------------------------
// Browser fallback (no Electron): direct fetch, key read from the settings UI.
// ---------------------------------------------------------------------------

function keyFromInput() {
  return document.getElementById("ai-api-key")?.value || "";
}

function buildHeaders(payload) {
  const headers = { "Content-Type": "application/json" };
  if (payload.provider === "openrouter") {
    const apiKey = keyFromInput();
    if (!apiKey) {
      throw new Error("Fehlender API-Key für OpenRouter. Bitte unter Einstellungen eintragen.");
    }
    headers["Authorization"] = `Bearer ${apiKey}`;
    if (payload.referer) headers["HTTP-Referer"] = payload.referer;
    if (payload.title) headers["X-Title"] = payload.title;
  }
  return headers;
}

function buildBody(payload) {
  const body = {
    model: payload.model,
    messages: payload.messages,
    stream: Boolean(payload.stream),
  };
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.maxTokens !== undefined) body.max_tokens = payload.maxTokens;
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    body.tools = payload.tools;
    if (payload.toolChoice) body.tool_choice = payload.toolChoice;
  }
  return body;
}

async function directFetch(payload) {
  let headers;
  try {
    headers = buildHeaders(payload);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const res = await fetch(payload.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(payload)),
      signal: payload.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, statusText: res.statusText, detail };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    if (err.name === "AbortError") return { ok: false, aborted: true };
    return { ok: false, error: err.message || String(err) };
  }
}

async function directStreamFetch(payload, { signal, onChunk }) {
  const headers = buildHeaders(payload);
  const response = await fetch(payload.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildBody(payload)),
    signal,
  });
  if (!response.ok) {
    let msg = describeHttpStatus(response.status);
    if (response.status === 401 || response.status === 403) {
      try {
        const detail = await response.text();
        if (detail) msg = `${msg} (${detail.slice(0, 200)})`;
      } catch {
        /* ignore */
      }
    }
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock?.();
  }
}
