#!/usr/bin/env bash
set -euo pipefail

archive_path=""
demo_root=""
theme_root=""
expected_sha256="${PRESS_RELEASE_SHA256:-}"
expected_size="${PRESS_RELEASE_SIZE:-}"
release_tag="${PRESS_RELEASE_TAG:-}"

usage() {
  echo "usage: $0 --demo-root path --theme-root path --archive path [--tag vX.Y.Z] [--sha256 sha256] [--size bytes]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || usage
      archive_path="$2"
      shift 2
      ;;
    --demo-root)
      [[ $# -ge 2 ]] || usage
      demo_root="$2"
      shift 2
      ;;
    --theme-root)
      [[ $# -ge 2 ]] || usage
      theme_root="$2"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || usage
      release_tag="$2"
      shift 2
      ;;
    --sha256)
      [[ $# -ge 2 ]] || usage
      expected_sha256="$2"
      shift 2
      ;;
    --size)
      [[ $# -ge 2 ]] || usage
      expected_size="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "${archive_path}" || -z "${demo_root}" || -z "${theme_root}" ]]; then
  usage
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
data_path="${repo_root}/scripts/demo-site-data.json"
release_manifest_path="${repo_root}/theme-release.json"

if [[ ! -f "${archive_path}" ]]; then
  echo "release archive not found: ${archive_path}" >&2
  exit 1
fi
if [[ ! -d "${theme_root}" ]]; then
  echo "theme root not found: ${theme_root}" >&2
  exit 1
fi
if [[ ! -f "${data_path}" ]]; then
  echo "demo site data not found: ${data_path}" >&2
  exit 1
fi

actual_size="$(wc -c < "${archive_path}" | tr -d ' ')"
if [[ -n "${expected_size}" && "${actual_size}" != "${expected_size}" ]]; then
  echo "release archive size mismatch: expected ${expected_size}, got ${actual_size}" >&2
  exit 1
fi

actual_sha256="$(shasum -a 256 "${archive_path}" | awk '{print $1}')"
expected_sha256="${expected_sha256#sha256:}"
if [[ -n "${expected_sha256}" && "${actual_sha256}" != "${expected_sha256}" ]]; then
  echo "release archive SHA-256 mismatch: expected ${expected_sha256}, got ${actual_sha256}" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

entries_file="${tmp_dir}/entries.txt"
unzip -Z1 "${archive_path}" > "${entries_file}"

payload_root=""
while IFS= read -r entry; do
  [[ -n "${entry}" ]] || continue
  if [[ "${entry}" == /* || "${entry}" == *\\* ]]; then
    echo "unsafe archive path: ${entry}" >&2
    exit 1
  fi

  IFS='/' read -r -a parts <<< "${entry}"
  for part in "${parts[@]}"; do
    if [[ "${part}" == ".." ]]; then
      echo "unsafe archive path: ${entry}" >&2
      exit 1
    fi
  done

  top="${parts[0]}"
  [[ -n "${top}" ]] || continue
  if [[ -z "${payload_root}" ]]; then
    payload_root="${top}"
  elif [[ "${payload_root}" != "${top}" ]]; then
    echo "release archive must contain a single top-level payload directory" >&2
    exit 1
  fi
done < "${entries_file}"

if [[ -z "${payload_root}" ]]; then
  echo "release archive is empty" >&2
  exit 1
fi

if [[ -n "${release_tag}" && "${payload_root}" != "press-system-${release_tag}" ]]; then
  echo "release archive root ${payload_root} does not match ${release_tag}" >&2
  exit 1
fi

while IFS= read -r entry; do
  [[ -n "${entry}" ]] || continue
  [[ "${entry}" != */ ]] || continue
  rel="${entry#${payload_root}/}"
  [[ "${rel}" != "${entry}" ]] || continue

  case "${rel}" in
    index.html|index_editor.html|index_editor_preview.html|assets/main.js) ;;
    assets/js/*|assets/i18n/*|assets/schema/*|assets/themes/native/*) ;;
    assets/themes/packs.json)
      echo "system release archive must not provide demo packs.json" >&2
      exit 1
      ;;
    *)
      echo "unexpected system release file: ${rel}" >&2
      exit 1
      ;;
  esac
done < "${entries_file}"

extract_dir="${tmp_dir}/extract"
mkdir -p "${extract_dir}"
unzip -q "${archive_path}" -d "${extract_dir}"
payload_dir="${extract_dir}/${payload_root}"

require_payload_file() {
  local path="$1"
  if [[ ! -f "${payload_dir}/${path}" ]]; then
    echo "system release archive is missing ${path}" >&2
    exit 1
  fi
}

require_payload_dir() {
  local path="$1"
  if [[ ! -d "${payload_dir}/${path}" ]]; then
    echo "system release archive is missing ${path}/" >&2
    exit 1
  fi
}

copy_payload_file() {
  local path="$1"
  require_payload_file "${path}"
  mkdir -p "${demo_root}/$(dirname "${path}")"
  cp "${payload_dir}/${path}" "${demo_root}/${path}"
}

sync_payload_dir() {
  local path="$1"
  require_payload_dir "${path}"
  mkdir -p "${demo_root}/${path}"
  rsync -a --delete "${payload_dir}/${path}/" "${demo_root}/${path}/"
}

mkdir -p "${demo_root}"
for path in index.html index_editor.html index_editor_preview.html assets/main.js assets/js assets/i18n assets/schema assets/themes/native; do
  rm -rf "${demo_root}/${path}"
done

copy_payload_file "index.html"
copy_payload_file "index_editor.html"
copy_payload_file "index_editor_preview.html"
copy_payload_file "assets/main.js"
sync_payload_dir "assets/js"
sync_payload_dir "assets/i18n"
sync_payload_dir "assets/schema"
sync_payload_dir "assets/themes/native"
rm -f "${demo_root}/assets/themes/catalog.json"

export PRESS_DEMO_ROOT="${demo_root}"
export PRESS_THEME_ROOT="${theme_root}"
export PRESS_DEMO_DATA="${data_path}"
export PRESS_THEME_RELEASE_MANIFEST="${release_manifest_path}"
export PRESS_RELEASE_TAG_VALUE="${release_tag}"
node <<'NODE'
const fs = require('fs');
const path = require('path');

const demoRoot = path.resolve(process.env.PRESS_DEMO_ROOT);
const themeRoot = path.resolve(process.env.PRESS_THEME_ROOT);
const dataPath = path.resolve(process.env.PRESS_DEMO_DATA);
const releaseManifestPath = path.resolve(process.env.PRESS_THEME_RELEASE_MANIFEST);
const releaseTag = process.env.PRESS_RELEASE_TAG_VALUE || '';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const slug = String(data.slug || '').trim();
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
  throw new Error('demo site data slug must be a safe theme slug');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(rel, content) {
  const target = path.join(demoRoot, rel);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

function walk(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walk(absolute, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function frontMatter(post) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return [
    '---',
    `title: ${yamlString(post.title)}`,
    `date: ${yamlString(post.date)}`,
    `author: ${yamlString(data.author || data.siteTitle || data.label || slug)}`,
    'tags:',
    ...tags.map((tag) => `  - ${yamlString(tag)}`),
    `excerpt: ${yamlString(post.excerpt || '')}`,
    post.image ? `image: ${yamlString(post.image)}` : '',
    '---'
  ].filter(Boolean).join('\n');
}

function markdownPost(post) {
  const body = Array.isArray(post.body) ? post.body : [];
  const sourceNote = post.source ? [
    '## Source Note',
    `Primary image/source: [${post.source.label}](${post.source.page}). ${post.source.license}.`
  ] : [];
  const image = post.image ? [`![${post.title}](${post.image})`] : [];
  return [
    frontMatter(post),
    '',
    `# ${post.title}`,
    '',
    ...image,
    '',
    ...body.flatMap((paragraph) => [paragraph, '']),
    ...sourceNote,
    ''
  ].join('\n');
}

function sourceList() {
  const sources = [];
  const seen = new Set();
  for (const post of data.posts || []) {
    if (!post.source || seen.has(post.source.page)) continue;
    seen.add(post.source.page);
    sources.push(post.source);
  }
  return sources;
}

copyDir(themeRoot, path.join(demoRoot, 'assets', 'themes', slug));

const nativeManifest = JSON.parse(fs.readFileSync(path.join(demoRoot, 'assets', 'themes', 'native', 'theme.json'), 'utf8'));
const themeManifest = JSON.parse(fs.readFileSync(path.join(themeRoot, 'theme.json'), 'utf8'));
const releaseManifest = fs.existsSync(releaseManifestPath)
  ? JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'))
  : {};

const registry = [
  {
    value: 'native',
    label: String(nativeManifest.name || 'Native'),
    version: String(nativeManifest.version || ''),
    contractVersion: Number(nativeManifest.contractVersion || 1),
    builtIn: true,
    removable: false,
    source: { type: 'builtin' },
    release: releaseTag ? { tag: releaseTag } : {},
    files: walk(path.join(demoRoot, 'assets', 'themes', 'native'))
  },
  {
    value: slug,
    label: String(themeManifest.name || data.label || slug),
    version: String(themeManifest.version || releaseManifest.version || ''),
    contractVersion: Number(themeManifest.contractVersion || 1),
    builtIn: false,
    removable: true,
    source: {
      type: 'official',
      repo: data.repo || '',
      manifestUrl: `https://raw.githubusercontent.com/${data.repo || ''}/main/theme-release.json`
    },
    release: {
      tag: releaseManifest.release && releaseManifest.release.tag ? releaseManifest.release.tag : '',
      htmlUrl: releaseManifest.release && releaseManifest.release.htmlUrl ? releaseManifest.release.htmlUrl : '',
      publishedAt: releaseManifest.release && releaseManifest.release.publishedAt ? releaseManifest.release.publishedAt : '',
      assetName: releaseManifest.asset && releaseManifest.asset.name ? releaseManifest.asset.name : '',
      size: releaseManifest.asset && releaseManifest.asset.size ? Number(releaseManifest.asset.size) : 0,
      digest: releaseManifest.asset && releaseManifest.asset.digest ? releaseManifest.asset.digest : ''
    },
    files: walk(path.join(demoRoot, 'assets', 'themes', slug))
  }
];
writeFile('assets/themes/packs.json', `${JSON.stringify(registry, null, 2)}\n`);

writeFile('.nojekyll', '');
writeFile('README.md', [
  `# ${data.siteTitle}`,
  '',
  `This branch hosts the ${data.label} demo site for GitHub Pages.`,
  '',
  'The site is regenerated from the latest Press system release and the theme source on `main` by `sync-demo-from-press-release.yml`.',
  ''
].join('\n'));

writeFile('site.yaml', [
  `siteTitle: ${yamlString(data.siteTitle)}`,
  'siteDescription:',
  `  en: ${yamlString(data.siteDescription)}`,
  'contentRoot: wwwroot',
  'defaultLanguage: en',
  'themeMode: auto',
  `themePack: ${yamlString(slug)}`,
  'annotate:',
  '  enabled: false',
  'repo:',
  '  provider: github',
  '  owner: EkilyHQ',
  `  name: ${yamlString((data.repo || '').split('/').pop() || '')}`,
  '  branch: demo',
  ''
].join('\n'));

const posts = Array.isArray(data.posts) ? data.posts : [];
writeFile('wwwroot/index.yaml', [
  '# yaml-language-server: $schema=../assets/schema/index.json',
  '',
  ...posts.flatMap((post) => [
    `${post.id}:`,
    `  en: post/${post.id}/en.md`
  ]),
  ''
].join('\n'));

writeFile('wwwroot/tabs.yaml', [
  '# yaml-language-server: $schema=../assets/schema/tabs.json',
  '',
  'About:',
  '  en:',
  `    title: ${yamlString(data.aboutTitle || `About ${data.siteTitle}`)}`,
  '    location: tab/about/en.md',
  'Sources:',
  '  en:',
  '    title: "Sources"',
  '    location: tab/sources/en.md',
  ''
].join('\n'));

writeFile('wwwroot/tab/about/en.md', [
  `# ${data.aboutTitle || `About ${data.siteTitle}`}`,
  '',
  data.about || '',
  '',
  `This demo uses the \`${slug}\` theme and fictional editorial content generated for theme testing.`,
  ''
].join('\n'));

writeFile('wwwroot/tab/sources/en.md', [
  '# Sources',
  '',
  'The demo articles use public-domain or CC0 source material. Each article repeats the relevant source note.',
  '',
  ...sourceList().flatMap((source) => [
    `- [${source.label}](${source.page}) - ${source.license}.`,
  ]),
  ''
].join('\n'));

for (const post of posts) {
  writeFile(`wwwroot/post/${post.id}/en.md`, markdownPost(post));
}

console.log(`Synced ${data.label || slug} demo site into ${demoRoot}.`);
NODE
