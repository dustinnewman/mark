#!/usr/bin/env bash
# Produce a single-file executable `build/mark`.
# Uses Node's single-executable support when this Node build has it, otherwise `deno compile`.
set -euo pipefail
cd "$(dirname "$0")/.."
node --disable-warning=ExperimentalWarning scripts/bundle-runtime.ts
node --disable-warning=ExperimentalWarning scripts/bundle-cli.ts
rm -f build/mark
if node --experimental-sea-config build/sea-config.json >/dev/null 2>&1; then
  cp "$(command -v node)" build/mark
  if [[ "$(uname)" == "Darwin" ]]; then codesign --remove-signature build/mark; fi
  npx --yes postject build/mark NODE_SEA_BLOB build/mark.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    $([[ "$(uname)" == "Darwin" ]] && echo "--macho-segment-name NODE_SEA")
  if [[ "$(uname)" == "Darwin" ]]; then codesign --sign - build/mark; fi
  echo "built build/mark (node sea)"
elif command -v deno >/dev/null 2>&1; then
  deno compile --quiet --allow-read --allow-write --allow-net --allow-env --allow-sys --output build/mark build/mark.cjs
  echo "built build/mark (deno compile)"
else
  echo "This Node build has no single-executable support and deno is not installed."
  echo "Use the self-contained bundle instead: node build/mark.cjs <command>"
  exit 1
fi
ls -la build/mark
