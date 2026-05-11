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

echo "ok - demo sync workflow"
