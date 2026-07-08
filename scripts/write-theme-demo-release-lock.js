#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--press-lock') options.pressLockPath = argv[++i] || '';
    else if (arg === '--theme-release') options.themeReleasePath = argv[++i] || '';
    else if (arg === '--theme-manifest') options.themeManifestPath = argv[++i] || '';
    else if (arg === '--packs') options.packsPath = argv[++i] || '';
    else if (arg === '--out') options.outPath = argv[++i] || '';
    else if (arg === '--repository') options.repository = argv[++i] || '';
    else if (arg === '--ref') options.ref = argv[++i] || '';
    else if (arg === '--slug') options.slug = argv[++i] || '';
    else if (arg === '--theme-release-source') options.themeReleaseSource = argv[++i] || '';
    else if (arg === '--reconciler') options.reconciler = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireValue(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function normalizeDigest(value) {
  const text = String(value || '').trim().replace(/^sha256:/i, '').toLowerCase();
  return text ? `sha256:${text}` : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultThemeReleaseSource(repository) {
  return `https://raw.githubusercontent.com/${repository}/main/theme-release.json`;
}

function validateReleaseManifest(manifest) {
  const slug = String(manifest.value || '').trim();
  const version = String(manifest.version || '').trim();
  const tag = String(manifest.release && manifest.release.tag || '').trim();
  const asset = manifest.asset && typeof manifest.asset === 'object' ? manifest.asset : {};
  if (manifest.schemaVersion !== 1 || manifest.type !== 'press-theme') {
    throw new Error('theme release manifest must be schemaVersion 1 and type press-theme');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
    throw new Error('theme release manifest value must be a safe theme slug');
  }
  if (!version || tag !== `v${version}`) {
    throw new Error('theme release manifest must declare matching version and release.tag');
  }
  if (!asset.name || !asset.url || !(Number(asset.size) > 0) || !normalizeDigest(asset.digest)) {
    throw new Error('theme release manifest asset must declare name, url, size, and digest');
  }
  return { slug, version, tag, asset };
}

function findPackEntry(packs, slug) {
  if (!Array.isArray(packs)) throw new Error('assets/themes/packs.json must be an array');
  return packs.find((entry) => String(entry && entry.value || '').trim() === slug) || null;
}

function validateThemeInstall({ slug, release, themeManifest, packs }) {
  if (String(themeManifest.version || '').trim() !== release.version) {
    throw new Error(`installed theme ${slug} version does not match theme release ${release.version}`);
  }
  if (Number(themeManifest.contractVersion || 0) !== Number(release.manifest.contractVersion || 0)) {
    throw new Error(`installed theme ${slug} contractVersion does not match theme release`);
  }
  const packEntry = findPackEntry(packs, slug);
  if (!packEntry) throw new Error(`packs.json is missing ${slug}`);
  if (String(packEntry.version || '').trim() !== release.version) {
    throw new Error(`packs.json ${slug} version does not match theme release ${release.version}`);
  }
  if (Number(packEntry.contractVersion || 0) !== Number(release.manifest.contractVersion || 0)) {
    throw new Error(`packs.json ${slug} contractVersion does not match theme release`);
  }
  const packRelease = packEntry.release && typeof packEntry.release === 'object' ? packEntry.release : {};
  if (String(packRelease.tag || '').trim() !== release.tag) {
    throw new Error(`packs.json ${slug} release tag does not match theme release`);
  }
  if (String(packRelease.assetName || '').trim() !== String(release.asset.name || '').trim()) {
    throw new Error(`packs.json ${slug} assetName does not match theme release`);
  }
  if (Number(packRelease.size || 0) !== Number(release.asset.size || 0)) {
    throw new Error(`packs.json ${slug} size does not match theme release`);
  }
  if (normalizeDigest(packRelease.digest) !== normalizeDigest(release.asset.digest)) {
    throw new Error(`packs.json ${slug} digest does not match theme release`);
  }
  return packEntry;
}

function buildLock(options) {
  const repository = requireValue(options.repository || process.env.GITHUB_REPOSITORY, 'repository');
  const targetRef = requireValue(options.ref || 'demo', 'ref');
  const pressLock = readJsonFile(requireValue(options.pressLockPath, 'press-lock'));
  const themeReleaseManifest = readJsonFile(requireValue(options.themeReleasePath, 'theme-release'));
  const themeManifest = readJsonFile(requireValue(options.themeManifestPath, 'theme-manifest'));
  const packs = readJsonFile(requireValue(options.packsPath, 'packs'));
  const release = validateReleaseManifest(themeReleaseManifest);
  release.manifest = themeReleaseManifest;
  const slug = requireValue(options.slug || release.slug, 'slug');
  if (slug !== release.slug) throw new Error(`slug ${slug} does not match theme release ${release.slug}`);
  if (pressLock.type !== 'press-system-release-lock') throw new Error('press-lock must be a press-system-release-lock');
  validateThemeInstall({ slug, release, themeManifest, packs });

  return {
    schemaVersion: 1,
    type: 'press-theme-demo-release-lock',
    repository,
    slug,
    target: {
      category: 'themeDemo',
      ref: targetRef,
      path: 'demo-release-lock.json',
      type: 'theme-demo-release-lock',
      reconciler: requireValue(options.reconciler || 'theme-demo-release-sync', 'reconciler'),
      observed: {
        pressSystem: {
          path: 'assets/press-system.json',
          type: 'press-system-manifest'
        },
        themeManifest: {
          path: `assets/themes/${slug}/theme.json`,
          type: 'press-theme-manifest'
        },
        themePacks: {
          path: 'assets/themes/packs.json',
          type: 'press-theme-packs'
        }
      }
    },
    pressSystem: {
      version: pressLock.version,
      tag: pressLock.tag,
      sourceKind: pressLock.sourceKind,
      releaseUrl: pressLock.releaseUrl,
      asset: clone(pressLock.asset || {}),
      releaseIntent: clone(pressLock.releaseIntent || null),
      upgradeFrom: clone(pressLock.upgradeFrom || null)
    },
    theme: {
      value: slug,
      label: String(themeReleaseManifest.label || slug).trim(),
      version: release.version,
      contractVersion: Number(themeReleaseManifest.contractVersion || 0),
      engines: clone(themeReleaseManifest.engines || {}),
      release: clone(themeReleaseManifest.release || {}),
      asset: {
        name: String(release.asset.name || '').trim(),
        url: String(release.asset.url || '').trim(),
        size: Number(release.asset.size || 0),
        digest: normalizeDigest(release.asset.digest)
      },
      releaseManifest: {
        source: String(options.themeReleaseSource || defaultThemeReleaseSource(repository)).trim()
      }
    }
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('usage: write-theme-demo-release-lock.js --press-lock path --theme-release path --theme-manifest path --packs path --out path --repository owner/name [--slug slug] [--ref demo]\n');
    return;
  }

  const outPath = options.outPath || 'demo-release-lock.json';
  const lock = buildLock(options);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`Updated ${outPath} for ${lock.theme.release.tag}.`);
}

main();
