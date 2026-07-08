#!/usr/bin/env node
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'scripts', 'write-theme-demo-release-lock.js');
const data = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'demo-site-data.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(repoRoot, 'theme-release.json'), 'utf8'));
const slug = String(data.slug || release.value || '').trim();
const repository = String(data.repo || `EkilyHQ/${path.basename(repoRoot)}`).trim();

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(args) {
  childProcess.execFileSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-demo-release-lock-'));
try {
  const pressLockPath = path.join(tmpDir, 'press-system-lock.json');
  const themeReleasePath = path.join(tmpDir, 'theme-release.json');
  const themeManifestPath = path.join(tmpDir, 'assets', 'themes', slug, 'theme.json');
  const packsPath = path.join(tmpDir, 'assets', 'themes', 'packs.json');
  const outPath = path.join(tmpDir, 'demo-release-lock.json');
  const themeManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'theme', 'theme.json'), 'utf8'));

  writeJson(pressLockPath, {
    schemaVersion: 1,
    type: 'press-system-release-lock',
    repository,
    target: {
      category: 'themeDemo',
      ref: 'demo',
      path: 'assets/press-system.json',
      type: 'press-system-manifest',
      reconciler: 'theme-demo-runtime-sync'
    },
    sourceKind: 'release-intent',
    version: '9.9.9',
    tag: 'v9.9.9',
    releaseUrl: 'https://github.com/EkilyHQ/Press/releases/tag/v9.9.9',
    asset: {
      name: 'press-system-v9.9.9.zip',
      url: 'https://raw.githubusercontent.com/EkilyHQ/Press/release-artifacts/v9.9.9/press-system-v9.9.9.zip',
      size: 456,
      digest: `sha256:${'a'.repeat(64)}`
    },
    releaseIntent: {
      type: 'press-release-intent',
      source: 'https://raw.githubusercontent.com/EkilyHQ/Press/release-artifacts/v9.9.9/release-intent.json'
    }
  });
  writeJson(themeReleasePath, release);
  writeJson(themeManifestPath, {
    ...themeManifest,
    version: release.version,
    contractVersion: release.contractVersion
  });
  writeJson(packsPath, [
    {
      value: 'native',
      version: '9.9.9',
      builtIn: true
    },
    {
      value: slug,
      label: release.label,
      version: release.version,
      contractVersion: release.contractVersion,
      source: {
        type: 'official',
        repo: repository,
        manifestUrl: `https://raw.githubusercontent.com/${repository}/main/theme-release.json`
      },
      release: {
        tag: release.release.tag,
        htmlUrl: release.release.htmlUrl,
        publishedAt: release.release.publishedAt,
        assetName: release.asset.name,
        size: release.asset.size,
        digest: release.asset.digest
      }
    }
  ]);

  run([
    '--press-lock', pressLockPath,
    '--theme-release', themeReleasePath,
    '--theme-manifest', themeManifestPath,
    '--packs', packsPath,
    '--out', outPath,
    '--repository', repository,
    '--slug', slug,
    '--ref', 'demo'
  ]);

  const lock = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.type, 'press-theme-demo-release-lock');
  assert.equal(lock.repository, repository);
  assert.equal(lock.slug, slug);
  assert.equal(lock.target.reconciler, 'theme-demo-release-sync');
  assert.equal(lock.target.observed.pressSystem.path, 'assets/press-system.json');
  assert.equal(lock.target.observed.themeManifest.path, `assets/themes/${slug}/theme.json`);
  assert.equal(lock.target.observed.themePacks.path, 'assets/themes/packs.json');
  assert.equal(lock.pressSystem.version, '9.9.9');
  assert.equal(lock.pressSystem.releaseIntent.source, 'https://raw.githubusercontent.com/EkilyHQ/Press/release-artifacts/v9.9.9/release-intent.json');
  assert.equal(lock.theme.value, slug);
  assert.equal(lock.theme.version, release.version);
  assert.equal(lock.theme.release.tag, release.release.tag);
  assert.equal(lock.theme.asset.digest, release.asset.digest);
  assert.equal(lock.theme.releaseManifest.source, `https://raw.githubusercontent.com/${repository}/main/theme-release.json`);

  const stalePacksPath = path.join(tmpDir, 'stale-packs.json');
  const stalePacks = JSON.parse(fs.readFileSync(packsPath, 'utf8'));
  stalePacks[1].release.digest = `sha256:${'b'.repeat(64)}`;
  writeJson(stalePacksPath, stalePacks);
  assert.throws(() => {
    run([
      '--press-lock', pressLockPath,
      '--theme-release', themeReleasePath,
      '--theme-manifest', themeManifestPath,
      '--packs', stalePacksPath,
      '--out', outPath,
      '--repository', repository,
      '--slug', slug
    ]);
  }, /digest does not match/);

  const staleManifestPath = path.join(tmpDir, 'stale-theme.json');
  writeJson(staleManifestPath, {
    ...themeManifest,
    version: '0.0.0',
    contractVersion: release.contractVersion
  });
  assert.throws(() => {
    run([
      '--press-lock', pressLockPath,
      '--theme-release', themeReleasePath,
      '--theme-manifest', staleManifestPath,
      '--packs', packsPath,
      '--out', outPath,
      '--repository', repository,
      '--slug', slug
    ]);
  }, /version does not match/);

  console.log('ok - theme demo release lock');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
