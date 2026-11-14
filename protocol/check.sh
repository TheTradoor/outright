#!/usr/bin/env bash
set -euo pipefail
protocol_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$protocol_root"
contract_output="$(mktemp)"
trap 'rm -f "$contract_output"' EXIT

node protocol/check-source.mjs
cargo run --locked --manifest-path protocol/conformance/Cargo.toml --bin export-contract > "$contract_output"
cmp "$contract_output" protocol/upstream-contract.json
cargo test --locked --manifest-path protocol/conformance/Cargo.toml --test oracle
npm test --prefix protocol
