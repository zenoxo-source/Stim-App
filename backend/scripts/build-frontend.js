/**
 * Build frontend bundle using esbuild.
 *
 * - Entry:  frontend/js/main.js
 * - Output: frontend/dist/bundle.js       (development, readable)
 *          frontend/dist/bundle.min.js   (production, minified)
 *
 * Replaces the previous terser concatenation pipeline. esbuild resolves the
 * full ES module import graph starting at main.js, so the jsOrder array and
 * mangle.reserved list are no longer needed.
 *
 * Usage: node scripts/build-frontend.js [--watch]
 */
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const frontendDir = path.join(rootDir, "frontend");
const entryPoint = path.join(frontendDir, "js", "main.js");
const outputDir = path.join(frontendDir, "dist");
const rawOut = path.join(outputDir, "bundle.js");
const minOut = path.join(outputDir, "bundle.min.js");

const watch = process.argv.includes("--watch");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/** @type {import('esbuild').BuildOptions} */
const baseOptions = {
  entryPoints: [entryPoint],
  bundle: true,
  format: "iife",
  target: ["chrome130"],
  platform: "browser",
  sourcemap: false,
  logLevel: "info",
  absWorkingDir: frontendDir,
};

async function build() {
  // Raw dev bundle (readable, with source map)
  console.log("esbuild: dev bundle...");
  await esbuild.build({
    ...baseOptions,
    outfile: rawOut,
    minify: false,
    sourcemap: "linked",
  });
  const rawSize = fs.statSync(rawOut).size;
  console.log(`esbuild: wrote ${rawOut} (${rawSize} bytes)`);

  // Minified production bundle
  console.log("esbuild: production bundle...");
  await esbuild.build({
    ...baseOptions,
    outfile: minOut,
    minify: true,
    sourcemap: false,
    legalComments: "none",
  });
  const minSize = fs.statSync(minOut).size;
  const reduction = ((1 - minSize / rawSize) * 100).toFixed(1);
  console.log(`esbuild: wrote ${minOut} (${minSize} bytes, -${reduction}% vs dev)`);
}

if (watch) {
  (async () => {
    const ctx = await esbuild.context({
      ...baseOptions,
      outfile: minOut,
      minify: false,
      sourcemap: "linked",
    });
    await ctx.watch();
    console.log("esbuild: watching for changes...");
  })();
} else {
  build().catch((err) => {
    console.error("esbuild build failed:", err);
    process.exit(1);
  });
}
