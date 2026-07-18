const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const rootDir = path.resolve(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const outputDir = path.join(frontendDir, 'dist');

// Must match the exact load order in frontend/index.html <script> tags
const jsOrder = [
  'js/state.js',
  'js/constants.js',
  'js/lib/protocol-utils.js',
  'js/control-deck.js',
  'js/modules/bluetooth.js',
  'js/modules/audio.js',
  'js/modules/highscores.js',
  'js/modules/games.js',
  'js/modules/games-extra.js',
  'js/modules/presets.js',
  'js/modules/ai-bridge.js',
  'js/modules/settings.js',
  'js/modules/safety.js',
  'js/modules/status-ui.js',
  'js/modules/onboarding.js',
  'js/modules/sessions.js',
  'js/modules/updater-ui.js',
  'js/llm-service.js',
];

async function buildFrontend() {
  console.log('Gathering frontend JS in load order...');

  let combined = '';
  for (const relPath of jsOrder) {
    const fullPath = path.join(frontendDir, relPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`Missing file: ${fullPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    combined += `\n/* --- ${relPath} --- */\n`;
    combined += content;
    combined += '\n';
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const rawOut = path.join(outputDir, 'bundle.js');
  fs.writeFileSync(rawOut, combined);
  console.log(`Raw bundle written: ${rawOut} (${combined.length} bytes)`);

  console.log('Minifying with terser...');
  const result = await minify(combined, {
    compress: {
      drop_console: false,
      drop_debugger: true,
      passes: 2,
    },
    mangle: {
      reserved: [
        'AppState',
        'DOM',
        'CONSTANTS',
        'SESSIONS',
        'SESSION_STATE',
        'ProtocolUtils',
      ],
    },
    format: {
      comments: /^(?!.*---)/,
      max_line_len: 120,
    },
  });

  if (result.error) {
    console.error('Terser minification failed:', result.error);
    process.exit(1);
  }

  const minOut = path.join(outputDir, 'bundle.min.js');
  fs.writeFileSync(minOut, result.code);
  console.log(`Minified bundle written: ${minOut} (${result.code.length} bytes)`);
  console.log(
    `Size reduction: ${((1 - result.code.length / combined.length) * 100).toFixed(1)}%`
  );
}

buildFrontend().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
