// llm-proxy-renderer.test.js — renderer-side fallback of lib/llm-proxy.js.
//
// window.electronAPI is absent in Node (dom-mock maps window → globalThis),
// so every call here exercises the plain-browser fallback: direct fetch with
// the key from the settings input. A local HTTP server stands in for the AI
// provider.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import "./helpers/dom-mock.js";
import { getLLMKeyStatus, chatLLM, streamChatLLM } from "../../frontend/js/lib/llm-proxy.js";

let server;
let baseUrl;
let lastAuthHeader = null;
let requests = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, auth: req.headers.authorization || null, body });
    lastAuthHeader = req.headers.authorization || null;

    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"He"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      }, 30);
      return;
    }
    if (req.url === "/error") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid key" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

beforeEach(() => {
  requests = [];
  lastAuthHeader = null;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  const input = document.getElementById("ai-api-key");
  if (input) input.value = "";
});

function setKeyInput(value) {
  let input = document.getElementById("ai-api-key");
  if (!input) {
    input = document.createElement("input");
    input.setAttribute("id", "ai-api-key");
    document.body.appendChild(input);
  }
  input.value = value;
  return input;
}

describe("llm-proxy renderer fallback — key status", () => {
  test("reports hasKey from the settings input", async () => {
    setKeyInput("");
    assert.equal((await getLLMKeyStatus()).hasKey, false);
    setKeyInput("sk-test");
    const status = await getLLMKeyStatus();
    assert.equal(status.hasKey, true);
    assert.equal(status.hint, "••••");
  });
});

describe("llm-proxy renderer fallback — non-streaming chat", () => {
  test("posts the body and returns parsed data", async () => {
    const r = await chatLLM({
      provider: "ollama",
      endpoint: `${baseUrl}/ok`,
      model: "qwen2.5",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.choices[0].message.content, "ok");
    assert.equal(requests.length, 1);
    const sent = JSON.parse(requests[0].body);
    assert.equal(sent.model, "qwen2.5");
    assert.equal(sent.stream, false);
  });

  test("attaches Authorization for openrouter when a key is set", async () => {
    setKeyInput("sk-test-456");
    const r = await chatLLM({
      provider: "openrouter",
      endpoint: `${baseUrl}/ok`,
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    assert.equal(r.ok, true);
    assert.equal(lastAuthHeader, "Bearer sk-test-456");
  });

  test("fails with a friendly error when the key is missing", async () => {
    const r = await chatLLM({
      provider: "openrouter",
      endpoint: `${baseUrl}/ok`,
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /API-Key/);
    assert.equal(requests.length, 0);
  });

  test("maps HTTP 401 to a status result", async () => {
    setKeyInput("sk-test");
    const r = await chatLLM({
      provider: "openrouter",
      endpoint: `${baseUrl}/error`,
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });
});

describe("llm-proxy renderer fallback — streaming chat", () => {
  test("delivers SSE chunks and resolves", async () => {
    const chunks = [];
    await streamChatLLM(
      {
        provider: "ollama",
        endpoint: `${baseUrl}/stream`,
        model: "m",
        messages: [{ role: "user", content: "x" }],
      },
      { onChunk: (text) => chunks.push(text) }
    );
    assert.ok(chunks.length >= 2);
    const all = chunks.join("");
    assert.match(all, /"content":"He"/);
    assert.match(all, /"content":"llo"/);
    assert.match(all, /\[DONE\]/);
  });

  test("aborts the fetch and rejects with AbortError", async () => {
    const controller = new AbortController();
    const promise = streamChatLLM(
      {
        provider: "ollama",
        endpoint: `${baseUrl}/stream`,
        model: "m",
        messages: [{ role: "user", content: "x" }],
      },
      { signal: controller.signal, onChunk: () => {} }
    );
    controller.abort();
    await assert.rejects(promise, (err) => err.name === "AbortError");
  });
});
