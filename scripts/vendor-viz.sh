#!/bin/sh
# Regenerate vendor/viz from the published @viz-js/viz package: download the exact version,
# refuse it unless its npm integrity matches, copy the CommonJS build and the package's SLSA
# provenance, and rewrite SHA256SUMS. To move to another release, change both values below and
# the expectations in test/vendor.test.ts. CI never runs this; it only checks SHA256SUMS.
set -eu

VERSION=3.30.0
INTEGRITY=sha512-2zmcP55QY44uQfZ+GvgNHmGd8S6KUD+2eMur9AbYybSzrOd/m8nMUg0ZircJNiJRKGgVBKAE8kh0hAwpUFUFQQ==

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$work"
tarball=$(npm pack --silent "@viz-js/viz@$VERSION")
actual="sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)"
if [ "$actual" != "$INTEGRITY" ]; then
  echo "integrity mismatch for @viz-js/viz@$VERSION: $actual" >&2
  exit 1
fi
tar -xzf "$tarball"

cp package/dist/viz.cjs "$root/vendor/viz/viz.cjs"
cp package/lib/provenance.json "$root/vendor/viz/provenance.json"
cd "$root/vendor/viz"
shasum -a 256 viz.cjs provenance.json > SHA256SUMS
cat SHA256SUMS
