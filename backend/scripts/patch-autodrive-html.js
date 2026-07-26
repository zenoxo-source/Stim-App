const fs = require("fs");
const path = require("path");
const htmlPath = path.join(__dirname, "../../frontend/index.html");
const h = fs.readFileSync(htmlPath, "utf8");
const start = h.indexOf("<!-- View: Autodrive -->");
const end = h.indexOf("<!-- Autodrive Fullscreen");
if (start < 0 || end < 0) {
  console.error("markers not found", start, end);
  process.exit(1);
}
const section = fs.readFileSync(path.join(__dirname, "autodrive-section.html"), "utf8");
const out = h.slice(0, start) + section + h.slice(end);
fs.writeFileSync(htmlPath, out, "utf8");
console.log("spliced ok", out.length);
