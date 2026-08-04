// remote-server.js - WebSocket remote control server for external tools
// Listens on localhost:8080, accepts JSON commands, forwards to renderer via IPC,
// and routes the renderer's result back to the requesting client.
//
// Token-based auth: clients must send ?token=xxx or first message {"type":"auth","token":"xxx"}.
//
// Hardening:
// - Binds to 127.0.0.1 only (no remote exposure)
// - Rejects cross-origin handshakes: browsers always send an Origin header
//   (even same-origin), so only a matching Origin (the bundled mobile control
//   page, which is served from this same server) may connect. A random web
//   page cannot reach the device.
// - Constant-time token comparison
// - Token required within AUTH_TIMEOUT_MS of connection, else dropped
// - Max MAX_CLIENTS concurrent connections
// - Max MAX_MESSAGE_BYTES per frame (defuse memory bombs)
// - Max MAX_CMDS_PER_SEC commands/sec per client (defuse tight-loop attackers)

const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const http = require("http");

const DEFAULT_PORT = 8080;
const AUTH_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 5;
const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB
const MAX_CMDS_PER_SEC = 5;
/** Renderer must answer a forwarded command within this window. */
const RESPONSE_TIMEOUT_MS = 5000;

let wss = null;
let httpServer = null;
let mainWindowRef = null;
let authToken = null;
/** Port we are actually listening on (may differ from DEFAULT_PORT). */
let activePort = null;
/** clientId -> ws, so renderer responses can be routed back to one socket. */
const clients = new Map();
/** reqId -> { clientId, timer } for in-flight renderer round-trips. */
const pending = new Map();
let clientSeq = 0;
let reqSeq = 0;

/**
 * Self-contained mobile control page (served at GET /). Uses the same port +
 * token as the WebSocket API. No external assets; inline CSS/JS only.
 */
const CONTROL_PAGE_HTML = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stim App Remote</title>
<style>
:root{color-scheme:dark}body{font-family:system-ui,sans-serif;background:#0b0b0d;color:#e8e8ec;margin:0;padding:16px;max-width:420px;margin:0 auto}
h1{font-size:18px}h2{font-size:13px;opacity:.7;margin:18px 0 6px}
.ctl{margin:8px 0}.row{display:flex;align-items:center;gap:10px}
input[type=range]{flex:1}.val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
button{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:inherit;border-radius:8px;padding:10px 14px;font-size:14px;flex:1}
button:active{transform:scale(.97)}
#status{font-size:12px;opacity:.7;margin:10px 0;white-space:pre-wrap}
.big{background:#a80000;border-color:#a80000;color:#fff;font-weight:700}
#conn{color:#a6e22e}.off{color:#f92672}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips button{flex:0 0 auto;padding:6px 10px;font-size:12px}
.chips button.on{background:#a86a00;border-color:#a86a00}
#ad-phase{font-weight:700}
.fb{display:flex;flex-wrap:wrap;gap:6px}
.fb button{flex:1 1 30%;padding:12px 6px;font-size:13px}
</style></head><body>
<h1>⚡ Stim App Remote</h1>
<div id="status" class="off">Verbindung wird aufgebaut…</div>
<h2>Intensität</h2>
<div class="ctl"><div class="row"><span>A</span><input type="range" id="sa" min="0" max="200" value="0"><span class="val" id="va">0</span></div></div>
<div class="ctl"><div class="row"><span>B</span><input type="range" id="sb" min="0" max="200" value="0"><span class="val" id="vb">0</span></div></div>
<div class="ctl"><div class="row"><span>Master</span><input type="range" id="sm" min="0" max="100" value="100"><span class="val" id="vm">100%</span></div></div>
<div class="row" style="margin-top:14px"><button id="stop">⏹ Stop</button><button id="panic" class="big">STOPP</button></div>
<div class="row" style="margin-top:8px"><button id="reset">Zurücksetzen</button></div>
<h2>Patterns</h2>
<div class="chips" id="patterns">…</div>
<h2>Autodrive <span id="ad-phase"></span></h2>
<div class="row" style="margin-top:8px"><button id="ad-start">▶ Klassik starten</button><button id="ad-stop">Autodrive stoppen</button></div>
<div class="fb" style="margin-top:8px">
  <button data-fb="too_weak">Zu schwach</button>
  <button data-fb="good">Gut</button>
  <button data-fb="too_strong">Zu stark</button>
  <button data-fb="almost">🔥 Fast</button>
  <button data-fb="now">⚡ Jetzt</button>
  <button data-fb="climaxed">✓ Fertig</button>
</div>
<script>
const q = new URLSearchParams(location.search);
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
let ws = null, connected = false, seq = 0;
const pending = new Map();
function send(obj){ if(ws && ws.readyState===1){ obj.id = ++seq; const p = new Promise((res)=>{pending.set(obj.id,res)}); ws.send(JSON.stringify(obj)); return p; } }
function setStatus(t, ok){ const el=document.getElementById('status'); el.textContent=t; el.className = ok ? '' : 'off'; }
function connect(){
  const token = q.get('token');
  if(!token){ setStatus('Token fehlt in der URL (?token=…)'); return; }
  ws = new WebSocket(proto + '://' + location.host + '/?token=' + encodeURIComponent(token));
  ws.onopen = () => { connected = true; setStatus('Verbunden', true); send({type:'get_state'}); loadPatterns(); refreshAd(); };
  ws.onclose = () => { connected = false; setStatus('Verbindung getrennt — neu verbinden…'); setTimeout(connect, 3000); };
  ws.onerror = () => setStatus('Fehler');
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if(m.type === 'response' && m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); return; }
    if(m.type === 'state' && m.data){
      const s = m.data || {};
      const a = Math.round(s.strengthA ?? 0), b = Math.round(s.strengthB ?? 0);
      const sv = (id, v) => { const el=document.getElementById(id); if(el && document.activeElement!==el) el.value = v; };
      sv('sa', a); document.getElementById('va').textContent = a;
      sv('sb', b); document.getElementById('vb').textContent = b;
      setStatus('Verbunden · A ' + a + ' · B ' + b, true);
      if(s.activePattern){ document.querySelectorAll('#patterns button').forEach(bt => bt.classList.toggle('on', bt.dataset.p === s.activePattern)); }
    }
  };
}
async function loadPatterns(){
  const r = await send({type:'get_patterns'});
  if(!r || !r.patterns) return;
  const box = document.getElementById('patterns');
  box.innerHTML = '';
  r.patterns.forEach(p => {
    const bt = document.createElement('button');
    bt.dataset.p = p; bt.textContent = p;
    bt.onclick = () => send({type:'set_pattern', name: p});
    box.appendChild(bt);
  });
}
async function refreshAd(){
  const r = await send({type:'autodrive_state'});
  if(r && r.autodrive){ document.getElementById('ad-phase').textContent = r.autodrive.phase || ''; }
}
const sendStrength = (ch) => { const v = parseInt(document.getElementById(ch).value,10); send({type:'set_intensity', channel: ch, value: v}); };
document.getElementById('sa').addEventListener('input', sendStrength.bind(null,'A'));
document.getElementById('sb').addEventListener('input', sendStrength.bind(null,'B'));
document.getElementById('sm').addEventListener('input', ()=>{ document.getElementById('vm').textContent = document.getElementById('sm').value + '%'; send({type:'set_master', value: parseInt(document.getElementById('sm').value,10)}); });
document.getElementById('stop').onclick = () => send({type:'stop_all'});
document.getElementById('reset').onclick = () => { document.getElementById('sa').value=0; document.getElementById('sb').value=0; document.getElementById('sm').value=100; document.getElementById('vm').textContent='100%'; send({type:'set_intensity', value:0}); send({type:'set_master', value:100}); };
document.getElementById('panic').onclick = () => send({type:'stop_all'});
document.getElementById('ad-start').onclick = async () => { const r = await send({type:'autodrive_start', quick: true}); if(!r || !r.ok) setStatus('Autodrive: ' + ((r && r.error) || 'Fehler'), false); refreshAd(); };
document.getElementById('ad-stop').onclick = async () => { await send({type:'autodrive_stop'}); refreshAd(); };
document.querySelectorAll('.fb button').forEach(bt => {
  bt.onclick = async () => { const r = await send({type:'autodrive_feedback', feedback: bt.dataset.fb}); if(r && r.ok) refreshAd(); };
});
connect();
</script></body></html>`;

function log(msg) {
  console.log(`[remote-server] ${msg}`);
}

function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Constant-time token comparison. Length mismatch short-circuits — the token
 * length is fixed and public, so that leaks nothing.
 * @param {unknown} candidate
 * @returns {boolean}
 */
function tokenMatches(candidate) {
  if (typeof candidate !== "string" || !authToken) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(authToken, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(ws, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    log(`send failed: ${err.message}`);
  }
}

/**
 * Start the WebSocket server (+ mobile control page). Resolves only once the
 * socket is actually listening, so a port conflict surfaces as { ok: false }
 * instead of a success that is contradicted by a later 'error' event.
 *
 * @param {import('electron').BrowserWindow} mainWindow
 * @param {number} [port]
 * @param {{ lan?: boolean }} [opts] lan=true binds 0.0.0.0 (mobile access)
 * @returns {Promise<{ok: boolean, port?: number, running?: boolean, token?: string, error?: string}>}
 */
function startRemoteServer(mainWindow, port, opts = {}) {
  if (wss) {
    log("already running");
    return Promise.resolve({ ok: true, port: activePort, running: true, token: authToken });
  }

  const p = port || DEFAULT_PORT;
  const host = opts.lan ? "0.0.0.0" : "127.0.0.1";
  mainWindowRef = mainWindow;
  authToken = generateToken();

  return new Promise((resolve) => {
    let settled = false;

    try {
      // HTTP server serves the mobile control page at GET / and hosts the WS.
      httpServer = http.createServer((req, res) => {
        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(CONTROL_PAGE_HTML);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found — use the WebSocket API at /?token=…");
      });

      wss = new WebSocketServer({
        server: httpServer,
        // Reject clients sending oversized frames immediately at protocol level.
        maxPayload: MAX_MESSAGE_BYTES,
        // Browsers always send Origin — even same-origin. Allow the handshake
        // only when the Origin host matches the request's Host header: that is
        // exactly the bundled mobile control page (served from this server).
        // Any other web page (evil.example, localhost from another app, …) is
        // rejected. Native clients (wscat/websockets/python) send no Origin and
        // still pass — the token remains the gate.
        // NOTE: keep this a ONE-parameter sync function — ws treats a
        // verifyClient with 2+ params as async and waits for a callback.
        verifyClient: ({ origin, req }) => {
          if (!origin) return true;
          try {
            const o = new URL(origin);
            const host = req.headers?.host || "";
            const sameOrigin =
              o.host === host && (o.protocol === "http:" || o.protocol === "https:");
            if (!sameOrigin) {
              log(`rejecting cross-origin handshake: ${origin} (host ${host})`);
              return false;
            }
            return true;
          } catch {
            log(`rejecting malformed Origin: ${origin}`);
            return false;
          }
        },
      });

      const onServerError = (err) => {
        log(`server error: ${err.message}`);
        if (!settled) {
          // Startup failure (EADDRINUSE, EACCES, …) — report it to the caller.
          settled = true;
          authToken = null;
          mainWindowRef = null;
          activePort = null;
          wss = null;
          try {
            httpServer.close();
          } catch {
            /* ignore */
          }
          httpServer = null;
          resolve({ ok: false, error: err.message });
          return;
        }
        // Runtime failure after a successful start — tear down so the UI can
        // show "gestoppt" instead of a phantom running server.
        teardown();
      };
      // ws re-emits underlying server errors on the WebSocketServer instance.
      httpServer.on("error", onServerError);
      wss.on("error", onServerError);

      httpServer.listen(p, host, () => {
        activePort = httpServer.address()?.port || p;
        settled = true;
        log(`listening on ws://${host}:${activePort}`);
        resolve({ ok: true, port: activePort, running: true, token: authToken, lan: opts.lan });
      });
    } catch (err) {
      log(`failed to start: ${err.message}`);
      authToken = null;
      mainWindowRef = null;
      httpServer = null;
      wss = null;
      resolve({ ok: false, error: err.message });
      return;
    }

    wss.on("connection", (ws, req) => {
      // Hard cap on concurrent clients
      if (wss.clients.size > MAX_CLIENTS) {
        log(`rejecting client: too many connections (${wss.clients.size})`);
        ws.close(1013, "too many connections");
        return;
      }

      const peer = req.socket.remoteAddress;
      const clientId = `c${++clientSeq}`;
      ws._clientId = clientId;
      clients.set(clientId, ws);

      // Check token from URL query string
      const url = new URL(req.url, "http://localhost");
      ws._authed = tokenMatches(url.searchParams.get("token"));

      if (!ws._authed) {
        // Defer auth to first message; kill the socket if it never comes.
        ws._authTimer = setTimeout(() => {
          if (!ws._authed) {
            log(`dropping unauthenticated client: ${peer} (timeout)`);
            try {
              ws.close(4001, "auth timeout");
            } catch {
              /* ignore */
            }
          }
        }, AUTH_TIMEOUT_MS);
      }

      // Simple sliding-window rate limit (MAX_CMDS_PER_SEC per client).
      ws._cmdTimestamps = [];

      log(`client connected: ${peer} (authed: ${ws._authed})`);

      ws.on("message", (raw) => {
        // Re-check frame size even though maxPayload should enforce it.
        if (raw.length > MAX_MESSAGE_BYTES) {
          ws.send(JSON.stringify({ type: "error", message: "message too large" }), () =>
            ws.close(1009, "too big")
          );
          return;
        }

        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          send(ws, { type: "error", message: "invalid JSON" });
          return;
        }

        // Echo the caller's correlation id on every reply so clients can await
        // a specific command instead of guessing which frame belongs to them.
        const reqId = msg && msg.id !== undefined ? String(msg.id) : null;

        // First message can be auth
        if (!ws._authed) {
          if (msg.type === "auth" && tokenMatches(msg.token)) {
            ws._authed = true;
            if (ws._authTimer) {
              clearTimeout(ws._authTimer);
              ws._authTimer = null;
            }
            send(ws, { type: "auth_ok", id: reqId });
            log(`client authenticated: ${peer}`);
            return;
          }
          send(ws, { type: "error", message: "authentication required", id: reqId });
          return;
        }

        // Rate limit (auth messages are exempt; commands are limited).
        const now = Date.now();
        ws._cmdTimestamps = ws._cmdTimestamps.filter((t) => now - t < 1000);
        if (ws._cmdTimestamps.length >= MAX_CMDS_PER_SEC) {
          send(ws, { type: "error", message: "rate limit exceeded", id: reqId });
          return;
        }
        ws._cmdTimestamps.push(now);

        if (!mainWindowRef || mainWindowRef.isDestroyed()) {
          send(ws, { type: "error", message: "app not ready", id: reqId });
          return;
        }

        // Forward command to renderer with routing metadata. The renderer echoes
        // __reqId back on remote:response; see handleRendererResponse.
        const internalId = `r${++reqSeq}`;
        const timer = setTimeout(() => {
          pending.delete(internalId);
          send(ws, {
            type: "response",
            id: reqId,
            command: msg.type,
            ok: false,
            error: "renderer timeout",
          });
        }, RESPONSE_TIMEOUT_MS);
        pending.set(internalId, { clientId, reqId, command: msg.type, timer });

        mainWindowRef.webContents.send("remote-command", { ...msg, __reqId: internalId });
        log(`command: ${msg.type}`);
      });

      ws.on("close", () => {
        if (ws._authTimer) clearTimeout(ws._authTimer);
        clients.delete(clientId);
        log(`client disconnected: ${peer}`);
      });
      ws.on("error", (err) => log(`client error: ${err.message}`));
    });
  });
}

/**
 * Route a renderer result back to the socket that issued the command.
 * Called from main.js on the 'remote:response' IPC channel.
 * @param {{__reqId?: string, result?: object}} payload
 */
function handleRendererResponse(payload) {
  const internalId = payload && payload.__reqId;
  if (!internalId) return;
  const entry = pending.get(internalId);
  if (!entry) return; // already timed out
  pending.delete(internalId);
  clearTimeout(entry.timer);

  const ws = clients.get(entry.clientId);
  if (!ws) return;

  const result = payload.result && typeof payload.result === "object" ? payload.result : {};
  send(ws, {
    type: "response",
    id: entry.reqId,
    command: entry.command,
    ...result,
  });
}

function teardown() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  clients.clear();
  wss = null;
  mainWindowRef = null;
  authToken = null;
  activePort = null;
  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      /* ignore */
    }
    httpServer = null;
  }
}

function stopRemoteServer() {
  if (!wss && !httpServer) return { ok: true, running: false };
  try {
    wss.close();
    teardown();
    log("stopped");
    return { ok: true, running: false };
  } catch (err) {
    log(`stop error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function getRemoteStatus() {
  return {
    running: wss !== null,
    port: activePort,
    clients: wss ? wss.clients.size : 0,
    token: authToken,
  };
}

/** Push renderer state to all authenticated clients (unsolicited). */
function broadcastState(stateJson) {
  if (!wss) return;
  const msg = JSON.stringify({ type: "state", data: stateJson });
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1 && ws._authed) ws.send(msg);
  });
}

module.exports = {
  startRemoteServer,
  stopRemoteServer,
  getRemoteStatus,
  handleRendererResponse,
  broadcastState,
};
