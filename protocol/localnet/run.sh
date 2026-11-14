#!/usr/bin/env bash
set -euo pipefail
native_root="$(cd "$(dirname "$0")/../.." && pwd)"
upstream_checkout="${1:?Pass the exact percolator-prog checkout directory}"
upstream_checkout="$(cd "$upstream_checkout" && pwd)"
shift
node "$native_root/protocol/check-source.mjs"
test "$(git -C "$upstream_checkout" rev-parse HEAD)" = 72dd8948b116e9e16a85c830e1e2a7915f12d542
test "$(git -C "$upstream_checkout" rev-parse HEAD^{tree})" = 8b54b827082b2b838beacd88d4d99bd12878d2ca
git -C "$upstream_checkout" diff --quiet HEAD
# Include ignored inputs: local ignore rules must not hide build configuration.
test -z "$(git -C "$upstream_checkout" ls-files --others -- src Cargo.toml Cargo.lock .cargo build.rs tests/fixtures/auth_matcher ':(exclude,glob)tests/fixtures/auth_matcher/target/**')"
test -z "${CARGO_TARGET_DIR:-}"
test -z "${PERCOLATOR_FUZZ_SBF:-}"
test -z "${SBF_OUT_PATH:-}"
case "$(cargo build-sbf --version)" in
  "cargo-build-sbf 4.6.0"*) ;;
  *) echo 'Use cargo-build-sbf 4.6.0' >&2; exit 1 ;;
esac
# Current-validator build, separate from the legacy LiteSVM v0 fixture.
for source_dir in "$upstream_checkout" "$upstream_checkout/tests/fixtures/auth_matcher"; do
  (cd "$source_dir" && cargo build-sbf --tools-version v1.58 --arch v3 --sbf-out-dir target/localnet-deploy -- --locked)
done
exec node "$native_root/protocol/localnet/cli.mjs" start \
  --program-binary "$upstream_checkout/target/localnet-deploy/percolator_prog.so" \
  --matcher-binary "$upstream_checkout/tests/fixtures/auth_matcher/target/localnet-deploy/auth_matcher.so" "$@"
