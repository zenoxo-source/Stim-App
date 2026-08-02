const { createRequire } = require("node:module");
const require2 = createRequire(__filename);
const WebSocket = require2("ws");
const net = require("node:net");
function freePort() { return new Promise((resolve, reject) => { const srv = net.createServer(); srv.once("error", reject); srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); }); }
function nextMessage(ws, timeoutMs) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("no message")), timeoutMs); ws.once("message", (raw) => { clearTimeout(t); resolve(raw.toString()); }); }); }
(async () => {
  const port = await freePort();
  const wss = new WebSocket.WebSocketServer({ port });
  wss.on("connection", (c) => { c.on("message", (raw) => { const m = JSON.parse(raw.toString()); c.send(JSON.stringify({ Id: m.Id, Type: "Echo" })); }); });
  let fails = 0;
  for (let i = 0; i < 10; i++) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("message", () => {});
      await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("open timeout")), 3000); ws.once("open", () => { clearTimeout(t); res(); }); ws.once("error", rej); });
      ws.send(JSON.stringify({ Id: 1, Type: "Ping" }));
      const m = await nextMessage(ws);
      if (m !== JSON.stringify({ Id: 1, Type: "Echo" })) throw new Error("bad echo");
      ws.close();
    } catch (e) { console.log(`run ${i}: FAIL ${e.message}`); fails++; }
  }
  console.log(`done, fails=${fails}`);
  wss.close();
})();
