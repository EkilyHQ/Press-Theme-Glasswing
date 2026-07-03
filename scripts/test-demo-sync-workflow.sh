#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

workflow=".github/workflows/sync-demo-from-press-release.yml"
pages_workflow=".github/workflows/pages.yml"
theme_release_workflow=".github/workflows/theme-release.yml"
script="scripts/sync-demo-from-press-release.sh"
data="scripts/demo-site-data.json"

for path in "${workflow}" "${pages_workflow}" "${theme_release_workflow}" "${script}" "${data}"; do
  if [[ ! -f "${path}" ]]; then
    echo "expected ${path} to exist" >&2
    exit 1
  fi
done

if ! grep -F 'repository_dispatch:' "${workflow}" >/dev/null; then
  echo "demo sync workflow must accept repository_dispatch events" >&2
  exit 1
fi

if ! grep -F 'press-system-release' "${workflow}" >/dev/null; then
  echo "demo sync workflow must listen for the press-system-release event" >&2
  exit 1
fi

if ! grep -F 'DEMO_BRANCH: demo' "${workflow}" >/dev/null; then
  echo "demo sync workflow must publish to the dedicated demo branch" >&2
  exit 1
fi

if ! grep -F 'scripts/sync-demo-from-press-release.sh' "${workflow}" >/dev/null; then
  echo "demo sync workflow must run the local sync script" >&2
  exit 1
fi

if ! grep -F 'scripts/resolve-press-system-release.js' "${workflow}" >/dev/null; then
  echo "demo sync workflow must resolve Press release intent before downloading the system package" >&2
  exit 1
fi

if ! grep -F 'scripts/write-press-system-lock.js' "${workflow}" >/dev/null || ! grep -F 'demo/press-system-lock.json' "${workflow}" >/dev/null; then
  echo "demo sync workflow must write a deterministic Press system lockfile into the demo branch" >&2
  exit 1
fi

if ! grep -F 'DISPATCH_RELEASE_INTENT_SOURCE' "${workflow}" >/dev/null; then
  echo "demo sync workflow must prefer release_intent.source from dispatch payloads" >&2
  exit 1
fi

if ! grep -F 'canonical_intent_source="https://raw.githubusercontent.com/${PRESS_REPOSITORY}/release-artifacts/${release_tag}/release-intent.json"' "${workflow}" >/dev/null; then
  echo "demo sync workflow must fall back to the immutable release-intent path for scheduled runs" >&2
  exit 1
fi

if ! grep -F 'payload_intent_source' "${workflow}" >/dev/null || ! grep -F 'dispatch release_intent.source must match' "${workflow}" >/dev/null; then
  echo "demo sync workflow must treat dispatch release_intent.source as a canonical-source consistency check only" >&2
  exit 1
fi

if ! grep -F 'legacy GitHub release metadata fallback has been sunset' "${workflow}" >/dev/null; then
  echo "demo sync workflow must fail closed after the legacy release metadata fallback sunset" >&2
  exit 1
fi

if ! grep -F 'PRESS_RELEASE_TARGET_RECONCILER="theme-demo-runtime-sync"' "${workflow}" >/dev/null; then
  echo "demo sync workflow must validate the theme demo release intent target kind" >&2
  exit 1
fi

if ! grep -F 'git push origin "HEAD:${DEMO_BRANCH}"' "${workflow}" >/dev/null; then
  echo "demo sync workflow must push the generated site to the demo branch" >&2
  exit 1
fi

if ! grep -F 'GITHUB_TOKEN: ${{ github.token }}' "${workflow}" >/dev/null; then
  echo "demo sync workflow must expose GITHUB_TOKEN when bootstrapping demo branch auth" >&2
  exit 1
fi

if ! grep -F 'https://x-access-token:%s@github.com/%s.git' "${workflow}" >/dev/null || ! grep -F 'GITHUB_REPOSITORY' "${workflow}" >/dev/null; then
  echo "demo sync workflow must bootstrap missing demo branch remotes with token-based auth" >&2
  exit 1
fi

if grep -F 'copy_checkout_git_auth' "${workflow}" >/dev/null || grep -F '.extraheader' "${workflow}" >/dev/null; then
  echo "demo sync workflow must not depend on checkout v4 extraheader auth copying" >&2
  exit 1
fi

if grep -F 'pull-requests: write' "${workflow}" >/dev/null; then
  echo "demo sync workflow must not request pull request permissions" >&2
  exit 1
fi

if ! grep -F 'workflow_run:' "${pages_workflow}" >/dev/null || ! grep -F -- '- Sync Demo From Press Release' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must deploy after successful demo sync runs" >&2
  exit 1
fi

if ! grep -F 'branches:' "${pages_workflow}" >/dev/null || ! grep -F -- '- main' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow_run trigger must be restricted to main-branch sync runs" >&2
  exit 1
fi

if ! grep -F 'workflow_dispatch:' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must support manual deploys" >&2
  exit 1
fi

if ! grep -F 'pages: write' "${pages_workflow}" >/dev/null || ! grep -F 'id-token: write' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must request Pages artifact deployment permissions" >&2
  exit 1
fi

if ! grep -F 'ref: demo' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must deploy the demo branch" >&2
  exit 1
fi

for needle in \
  'actions/checkout@v6' \
  'actions/configure-pages@v6' \
  'actions/upload-pages-artifact@v5' \
  'actions/deploy-pages@v5'
do
  if ! grep -F "${needle}" "${pages_workflow}" >/dev/null; then
    echo "demo Pages workflow must include ${needle}" >&2
    exit 1
  fi
done

if grep -E 'actions/(checkout@v4|configure-pages@v5|deploy-pages@v4|upload-artifact@v4|upload-pages-artifact@v3)' "${workflow}" "${pages_workflow}" "${theme_release_workflow}" >/dev/null; then
  echo "theme workflows must not pin known Node 20-backed GitHub actions" >&2
  exit 1
fi

if ! grep -F 'git ls-files -z -- .nojekyll index.html index_editor.html index_editor_preview.html site.yaml assets wwwroot' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must upload the generated demo site surface" >&2
  exit 1
fi

if ! grep -F 'path: dist/pages' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must deploy the prepared Pages artifact directory" >&2
  exit 1
fi

if ! grep -F 'include-hidden-files: true' "${pages_workflow}" >/dev/null; then
  echo "demo Pages workflow must include dotfiles such as .nojekyll in the Pages artifact" >&2
  exit 1
fi

if ! grep -F 'assets/themes/packs.json' "${script}" >/dev/null; then
  echo "demo sync script must regenerate packs.json for the installed theme" >&2
  exit 1
fi

if ! grep -F 'assets/press-system.json' "${script}" >/dev/null; then
  echo "demo sync script must copy the Press system version manifest" >&2
  exit 1
fi

if ! grep -F 'assets/press-runtime-manifest.json' "${script}" >/dev/null; then
  echo "demo sync script must copy the Press runtime asset manifest when present" >&2
  exit 1
fi

if ! grep -F 'wwwroot/index.yaml' "${script}" >/dev/null; then
  echo "demo sync script must generate demo content index data" >&2
  exit 1
fi

if ! grep -F "find \"\${payload_dir}\" -type l" "${script}" >/dev/null; then
  echo "demo sync script must reject symlink payload entries" >&2
  exit 1
fi

if ! grep -F "removePath('wwwroot/post')" "${script}" >/dev/null; then
  echo "demo sync script must clear stale generated post files" >&2
  exit 1
fi

node <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('scripts/demo-site-data.json', 'utf8'));
const theme = JSON.parse(fs.readFileSync('theme/theme.json', 'utf8'));
const releaseWorkflow = fs.readFileSync('.github/workflows/theme-release.yml', 'utf8');
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(data.slug || '')) {
  throw new Error('demo site data must define a safe slug');
}
if (!theme.engines || theme.engines.press !== '>=3.4.127 <4.0.0') {
  throw new Error('theme/theme.json must declare engines.press for Press v3.4.127 compatibility');
}
if (!releaseWorkflow.includes('themeManifest.engines') || !releaseWorkflow.includes('engines,')) {
  throw new Error('theme release workflow must copy theme engines into theme-release.json');
}
if (!Array.isArray(data.posts) || data.posts.length < 4) {
  throw new Error('demo site data must include at least four posts');
}
for (const post of data.posts) {
  if (!post.id || !post.title || !post.image || !post.source || !post.source.page || !post.source.license) {
    throw new Error(`demo post ${post.id || '(missing id)'} is missing required source fields`);
  }
}
NODE

node scripts/test-release-intent-resolution.js
node scripts/test-press-system-lock.js

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

create_release_payload() {
  local root="$1"
  local index_mode="${2:-regular}"
  local payload="${tmp_dir}/${root}"

  mkdir -p \
    "${payload}/assets/js" \
    "${payload}/assets/i18n" \
    "${payload}/assets/schema" \
    "${payload}/assets/themes/native"

  if [[ "${index_mode}" == "symlink" ]]; then
    ln -s /etc/passwd "${payload}/index.html"
  else
    printf '<!doctype html>\n' > "${payload}/index.html"
  fi

  printf '<!doctype html>\n' > "${payload}/index_editor.html"
  printf '<!doctype html>\n' > "${payload}/index_editor_preview.html"
  printf '{"schemaVersion":1,"type":"press-system","version":"0.0.0","tag":"v0.0.0","upgradeFrom":{"ranges":[],"allowUnknownSource":true,"message":""}}\n' > "${payload}/assets/press-system.json"
  if [[ "${index_mode}" != "without-runtime-manifest" ]]; then
    printf '{"schemaVersion":1,"type":"press-runtime-assets","version":"0.0.0","tag":"v0.0.0","cacheKey":"press-system-v0.0.0","strategy":"query-param","entries":[]}\n' > "${payload}/assets/press-runtime-manifest.json"
  fi
  printf 'console.log("main");\n' > "${payload}/assets/main.js"
  printf '{"name":"Native","version":"0.0.0","contractVersion":1,"engines":{"press":">=0.0.0 <1.0.0"}}\n' > "${payload}/assets/themes/native/theme.json"
  printf 'body {}\n' > "${payload}/assets/themes/native/theme.css"
}

create_release_payload press-system-v0.0.0
(cd "${tmp_dir}" && zip -qr press-system.zip press-system-v0.0.0)

mkdir -p "${tmp_dir}/demo/wwwroot/post/stale"
printf 'stale\n' > "${tmp_dir}/demo/wwwroot/post/stale/en.md"

bash "${script}" \
  --demo-root "${tmp_dir}/demo" \
  --theme-root theme \
  --archive "${tmp_dir}/press-system.zip" \
  --tag v0.0.0

if [[ -e "${tmp_dir}/demo/wwwroot/post/stale/en.md" ]]; then
  echo "demo sync script must remove stale generated post files" >&2
  exit 1
fi

if ! grep -F '"type":"press-runtime-assets"' "${tmp_dir}/demo/assets/press-runtime-manifest.json" >/dev/null; then
  echo "demo sync script must copy the Press runtime asset manifest" >&2
  exit 1
fi

create_release_payload press-system-v0.0.1 without-runtime-manifest
(cd "${tmp_dir}" && zip -qr legacy-press-system.zip press-system-v0.0.1)

bash "${script}" \
  --demo-root "${tmp_dir}/demo" \
  --theme-root theme \
  --archive "${tmp_dir}/legacy-press-system.zip" \
  --tag v0.0.1

if [[ -f "${tmp_dir}/demo/assets/press-runtime-manifest.json" ]]; then
  echo "demo sync script must remove stale runtime manifests when syncing older Press releases" >&2
  exit 1
fi

create_release_payload press-system-v0.0.2 symlink
(cd "${tmp_dir}" && zip -qry symlink-system.zip press-system-v0.0.2)

if bash "${script}" \
  --demo-root "${tmp_dir}/symlink-demo" \
  --theme-root theme \
  --archive "${tmp_dir}/symlink-system.zip" \
  --tag v0.0.2 >"${tmp_dir}/symlink.out" 2>"${tmp_dir}/symlink.err"; then
  echo "demo sync script must reject symlink payload files" >&2
  exit 1
fi

if ! grep -F 'system release archive contains symlink: index.html' "${tmp_dir}/symlink.err" >/dev/null; then
  echo "demo sync script must explain rejected symlink payload files" >&2
  exit 1
fi

echo "ok - demo sync workflow"
