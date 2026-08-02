// llm-proxy.test.js — LLM proxy in the main process.
//
// Plain Node (like remote-server.test.js): a local HTTP server stands in for
// the AI provider, and `send` captures the streaming events that would be
// routed to the renderer.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const {
  runLLMRequest,
  abortLLM,
  isAllowedLLMEndpoint,
  addLLMAllowedOrigin,
} = require("../src/llm-proxy.js");

/** Events the fake renderer would receive (llm:chunk / llm:done). */
let sentEvents = [];
function fakeSend(channel, payload) {
  sentEvents.push({ channel, payload });
}

let server;
let baseUrl;
let lastRequest = null;
let lastAuthHeader = null;
let streamController = null;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(body || "{}") };
    lastAuthHeader = req.headers.authorization || null;

    if (req.url === "/stream") {
      // Long-lived SSE stream the test can end/abort by closing the socket.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      streamController = { res, written: [] };
      res.write('data: {"choices":[{"delta":{"content":"He"}}]}\n\n');
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
  // The test server is not a real provider — register it explicitly.
  addLLMAllowedOrigin(baseUrl);
});

after(() => {
  if (server) server.close();
});

beforeEach(() => {
  sentEvents = [];
  lastRequest = null;
  lastAuthHeader = null;
  streamController = null;
  baseOpts.endpoint = `${baseUrl}/ok`;
});

const baseOpts = {
  reqId: "r1",
  provider: "ollama",
  endpoint: "http://127.0.0.1:1", // refreshed in beforeEach
  model: "qwen2.5",
  messages: [{ role: "user", content: "hallo" }],
  send: fakeSend,
};

describe("llm-proxy — endpoint allowlist", () => {
  test("accepts local Ollama", () => {
    assert.equal(isAllowedLLMEndpoint("http://localhost:11434/v1/chat/completions"), true);
  });
  test("accepts OpenRouter hosts", () => {
    assert.equal(isAllowedLLMEndpoint("https://openrouter.ai/api/v1/chat/completions"), true);
    assert.equal(isAllowedLLMEndpoint("https://api.openrouter.ai/v1/chat"), true);
  });
  test("accepts z.ai", () => {
    assert.equal(isAllowedLLMEndpoint("https://api.z.ai/v1/chat/completions"), true);
  });
  test("rejects arbitrary hosts (e.g. exfil endpoint)", () => {
    assert.equal(isAllowedLLMEndpoint("https://evil.example.com/v1/chat"), false);
    assert.equal(isAllowedLLMEndpoint("http://127.0.0.1:8080/v1"), false);
  });
  test("rejects garbage input", () => {
    assert.equal(isAllowedLLMEndpoint(""), false);
    assert.equal(isAllowedLLMEndpoint(null), false);
    assert.equal(isAllowedLLMEndpoint("not a url"), false);
  });
});

describe("llm-proxy — validation", () => {
  test("rejects a missing reqId", async () => {
    const r = await runLLMRequest({ ...baseOpts, reqId: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /reqId/);
  });
  test("rejects an endpoint outside the allowlist", async () => {
    const r = await runLLMRequest({ ...baseOpts, endpoint: "https://evil.example.com/v1" });
    assert.equal(r.ok, false);
    assert.match(r.error, /Allowlist/);
  });
  test("rejects a missing model", async () => {
    const r = await runLLMRequest({ ...baseOpts, model: "" });
    assert.equal(r.ok, false);
    assert.match(r.error, /model/);
  });
  test("rejects empty messages", async () => {
    const r = await runLLMRequest({ ...baseOpts, messages: [] });
    assert.equal(r.ok, false);
  });
  test("rejects non-string content", async () => {
    const r = await runLLMRequest({ ...baseOpts, messages: [{ role: "user", content: 42 }] });
    assert.equal(r.ok, false);
  });
  test("accepts vision-array content", async () => {
    const r = await runLLMRequest({
      ...baseOpts,
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: [{ type: "text", text: "b" }] },
      ],
      endpoint: `${baseUrl}/ok`,
    });
    assert.equal(r.ok, true);
  });
  test("rejects oversized messages", async () => {
    const r = await runLLMRequest({
      ...baseOpts,
      messages: [{ role: "user", content: "x".repeat(70 * 1024) }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /zu groß/);
  });
});

describe("llm-proxy — non-streaming request", () => {
  test("forwards the body and returns parsed data", async () => {
    const r = await runLLMRequest({
      ...baseOpts,
      endpoint: `${baseUrl}/ok`,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.choices[0].message.content, "ok");
    assert.equal(lastRequest.body.model, "qwen2.5");
    assert.equal(lastRequest.body.messages[0].content, "hi");
  });

  test("attaches the Authorization header for openrouter", async () => {
    const r = await runLLMRequest({
      ...baseOpts,
      provider: "openrouter",
      apiKey: "sk-test-123",
      endpoint: `${baseUrl}/ok`,
      referer: "http://localhost:3000",
      title: "StimApp Test",
    });
    assert.equal(r.ok, true);
    assert.equal(lastAuthHeader, "Bearer sk-test-123");
    assert.equal(lastRequest.headers["http-referer"], "http://localhost:3000");
    assert.equal(lastRequest.headers["x-title"], "StimApp Test");
  });

  test("refuses openrouter without a key", async () => {
    const r = await runLLMRequest({
      ...baseOpts,
      provider: "openrouter",
      apiKey: "",
      endpoint: `${baseUrl}/ok`,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /API-Key/);
  });

  test("maps HTTP errors to status results", async () => {
    const r = await runLLMRequest({ ...baseOpts, endpoint: `${baseUrl}/error` });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
    assert.match(r.detail, /invalid key/);
  });

  test("includes tools in the body when provided", async () => {
    const tools = [{ type: "function", function: { name: "stop_all" } }];
    await runLLMRequest({ ...baseOpts, endpoint: `${baseUrl}/ok`, tools, toolChoice: "auto" });
    assert.deepEqual(lastRequest.body.tools, tools);
    assert.equal(lastRequest.body.tool_choice, "auto");
  });
});

describe("llm-proxy — streaming request", () => {
  test("forwards chunks and a done event", async () => {
    const promise = runLLMRequest({
      ...baseOpts,
      endpoint: `${baseUrl}/stream`,
      stream: true,
    });
    // Let the server push a second chunk, then finish the stream.
    await new Promise((r) => setTimeout(r, 50));
    streamController.res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
    streamController.res.end();
    const r = await promise;

    assert.equal(r.ok, true);
    const chunks = sentEvents.filter((e) => e.channel === "llm:chunk");
    assert.equal(chunks.length, 2);
    // The proxy forwards raw SSE text; the renderer does the parsing.
    assert.equal(chunks[0].payload.chunk, 'data: {"choices":[{"delta":{"content":"He"}}]}\n\n');
    assert.equal(chunks[1].payload.chunk, 'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
    assert.equal(chunks[0].payload.reqId, "r1");
    assert.ok(sentEvents.some((e) => e.channel === "llm:done" && e.payload.reqId === "r1"));
  });

  test("abort mid-stream reports aborted and sends no done", async () => {
    const promise = runLLMRequest({
      ...baseOpts,
      reqId: "r-abort",
      endpoint: `${baseUrl}/stream`,
      stream: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    abortLLM("r-abort");
    streamController.res.destroy();
    const r = await promise;

    assert.equal(r.ok, false);
    assert.equal(r.aborted, true);
    assert.ok(!sentEvents.some((e) => e.channel === "llm:done"));
  });

  test("abort before the request starts also aborts", async () => {
    abortLLM("r-early");
    const r = await runLLMRequest({
      ...baseOpts,
      reqId: "r-early",
      endpoint: `${baseUrl}/stream`,
      stream: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.aborted, true);
  });
});
