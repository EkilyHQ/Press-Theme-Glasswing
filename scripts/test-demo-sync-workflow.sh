#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

workflow=".github/workflows/sync-demo-from-press-release.yml"
script="scripts/sync-demo-from-press-release.sh"
data="scripts/demo-site-data.json"

for path in "${workflow}" "${script}" "${data}"; do
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

if ! grep -F 'git push origin "HEAD:${DEMO_BRANCH}"' "${workflow}" >/dev/null; then
  echo "demo sync workflow must push the generated site to the demo branch" >&2
  exit 1
fi

if ! grep -F 'copy_checkout_git_auth' "${workflow}" >/dev/null; then
  echo "demo sync workflow must copy checkout git auth when bootstrapping demo" >&2
  exit 1
fi

if ! grep -F '.extraheader' "${workflow}" >/dev/null; then
  echo "demo sync workflow must preserve checkout auth extraheaders" >&2
  exit 1
fi

if grep -F 'pull-requests: write' "${workflow}" >/dev/null; then
  echo "demo sync workflow must not request pull request permissions" >&2
  exit 1
fi

if ! grep -F 'assets/themes/packs.json' "${script}" >/dev/null; then
  echo "demo sync script must regenerate packs.json for the installed theme" >&2
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
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(data.slug || '')) {
  throw new Error('demo site data must define a safe slug');
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
  printf 'console.log("main");\n' > "${payload}/assets/main.js"
  printf '{"name":"Native","version":"0.0.0","contractVersion":1}\n' > "${payload}/assets/themes/native/theme.json"
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

create_release_payload press-system-v0.0.1 symlink
(cd "${tmp_dir}" && zip -qry symlink-system.zip press-system-v0.0.1)

if bash "${script}" \
  --demo-root "${tmp_dir}/symlink-demo" \
  --theme-root theme \
  --archive "${tmp_dir}/symlink-system.zip" \
  --tag v0.0.1 >"${tmp_dir}/symlink.out" 2>"${tmp_dir}/symlink.err"; then
  echo "demo sync script must reject symlink payload files" >&2
  exit 1
fi

if ! grep -F 'system release archive contains symlink: index.html' "${tmp_dir}/symlink.err" >/dev/null; then
  echo "demo sync script must explain rejected symlink payload files" >&2
  exit 1
fi

echo "ok - demo sync workflow"
