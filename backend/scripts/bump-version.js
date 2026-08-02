/**
 * Bump the app version across all three version locations:
 *   - backend/package.json        (npm version <type> --no-git-tag-version)
 *   - README.md                   (**Version:** line)
 *   - CHANGELOG.md                (new "## X.Y.Z" entry at the top)
 *
 * Usage: node scripts/bump-version.js [patch|minor|major]
 *
 * The new CHANGELOG entry is inserted with a placeholder title/body so the
 * human author fills in the feature list (as before, but without being able
 * to forget bumping README/CHANGELOG in the first place).
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendDir = __dirname + "/..";
const rootDir = path.resolve(__dirname, "..", "..");
const readmePath = path.join(rootDir, "README.md");
const changelogPath = path.join(rootDir, "CHANGELOG.md");
const pkgPath = path.join(backendDir, "package.json");

const type = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(type)) {
  console.error(`Unknown bump type "${type}" — use patch, minor or major.`);
  process.exit(1);
}

function readVersion() {
  return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
}

function bumpSemver(current, kind) {
  const [maj, min, pat] = current.split(".").map((n) => parseInt(n, 10) || 0);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const before = readVersion();
const expected = bumpSemver(before, type);

console.log(`Bumping ${before} → ${expected} (${type})`);
execSync(`npm version ${type} --no-git-tag-version`, { cwd: backendDir, stdio: "inherit" });
const next = readVersion();

// README: **Version:** line (first occurrence)
let readme = fs.readFileSync(readmePath, "utf8");
const readmeRe = /(\*\*Version:\*\*\s*).+/;
if (!readmeRe.test(readme)) {
  console.warn("README: no **Version:** line found — skipped.");
} else {
  readme = readme.replace(readmeRe, `$1${next}`);
  fs.writeFileSync(readmePath, readme, "utf8");
  console.log(`README → ${next}`);
}

// CHANGELOG: insert new entry right after the "# Changelog" heading
let changelog = fs.readFileSync(changelogPath, "utf8");
const header = "# Changelog\n";
if (!changelog.startsWith(header)) {
  console.warn("CHANGELOG: unexpected header — entry not inserted, add it manually.");
} else {
  const entry =
    `${header}\n## ${next} – <Titel>\n\n` +
    `### Hinweise\n- (Changelog-Eintrag wird ausgefüllt)\n\n` +
    changelog.slice(header.length);
  fs.writeFileSync(changelogPath, entry, "utf8");
  console.log(`CHANGELOG → entry for ${next}`);
}

console.log("Done. Now edit the CHANGELOG entry title/body and commit + tag as usual.");
