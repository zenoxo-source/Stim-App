const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');

const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.resolve(__dirname, '..');
const srcFrontend = path.join(rootDir, 'frontend');
const destFrontend = path.join(backendDir, 'frontend');

const publish = process.argv.includes('--publish');

function detectPlatform() {
  const platform = os.platform();
  if (platform === 'win32') return ['--win', '--x64'];
  if (platform === 'darwin') return ['--mac', '--x64', '--arm64'];
  return ['--linux', '--x64'];
}

function switchToProductionBundle(frontendRoot) {
  const indexPath = path.join(frontendRoot, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  const scriptBlockRe = /(?:\s*<script src="js\/[^"]+"><\/script>\s*)+/g;
  const productionScripts = '\n  <script src="dist/bundle.min.js"></script>\n';
  if (!scriptBlockRe.test(html)) {
    console.warn('Could not locate script block in index.html for production swap.');
    return;
  }
  // Reset lastIndex after test()
  scriptBlockRe.lastIndex = 0;
  html = html.replace(scriptBlockRe, productionScripts);
  fs.writeFileSync(indexPath, html, 'utf8');

  const jsDir = path.join(frontendRoot, 'js');
  if (fs.existsSync(jsDir)) {
    fs.rmSync(jsDir, { recursive: true, force: true });
  }
  console.log('Production index uses dist/bundle.min.js; source JS removed from package.');
}

function prepareFrontend() {
  console.log('Building frontend bundle...');
  childProcess.execSync('node scripts/build-frontend.js', {
    cwd: backendDir,
    stdio: 'inherit',
  });

  console.log('Preparing frontend assets for packaging...');
  if (fs.existsSync(destFrontend)) {
    fs.rmSync(destFrontend, { recursive: true, force: true });
  }
  fs.cpSync(srcFrontend, destFrontend, { recursive: true });
  switchToProductionBundle(destFrontend);
  console.log('Frontend assets prepared for production.');
}

function runBuilder() {
  const platformArgs = detectPlatform();
  const args = ['electron-builder', ...platformArgs];
  if (publish) {
    args.push('--publish', 'always');
    if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      console.warn(
        'WARNING: GH_TOKEN / GITHUB_TOKEN not set. Publish to GitHub Releases will fail.'
      );
      console.warn(
        'Create a classic PAT with repo scope and: $env:GH_TOKEN="ghp_..."'
      );
    }
  } else {
    args.push('--publish', 'never');
  }

  console.log(`Packaging with electron-builder (${args.join(' ')})...`);
  childProcess.execSync(`npx ${args.join(' ')}`, {
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });
}

try {
  prepareFrontend();
  runBuilder();
  console.log("Desktop application built successfully in 'backend/dist-app/'!");
  if (publish) {
    console.log('Release assets should appear under GitHub Releases for zenoxo-source/Stim-App.');
  }
} catch (error) {
  console.error('Build process failed:', error.message);
  process.exit(1);
} finally {
  console.log('Cleaning up temp frontend assets...');
  if (fs.existsSync(destFrontend)) {
    fs.rmSync(destFrontend, { recursive: true, force: true });
  }
}
