#!/usr/bin/env python3
"""Qualify a base+overlay wrapper on the current validator without enrolling it."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import wrapper_qualification as qualification

ROOT = Path(__file__).resolve().parents[1]
BINARIES = {
    "program": "percolator-prog/target/localnet-deploy/percolator_prog.so",
    "matcher": "percolator-prog/tests/fixtures/auth_matcher/target/localnet-deploy/auth_matcher.so",
}
TOOLCHAIN = {"host_rust": "1.95.0", "cargo_build_sbf": "4.6.0", "platform_tools": "v1.58", "sbf_arch": "v3", "validator": "4.4.1"}
EXPECTED_ACTIONS = [
    ("initialize", None), ("deposit", None), ("trade", "buy"),
    ("trade", "sell"), ("trade", "sell"), ("trade", "buy"), ("withdraw", None),
]


def binary_hashes(workspace):
    return {key: qualification.digest(workspace / path) for key, path in BINARIES.items()}


def check_report(report, attestation):
    assert report["scope"] == "candidate-current-validator"
    assert report["status"] == "passed" and report["network"] == "localnet"
    assert report["identity"] == attestation, "Mixed candidate identity"
    assert [(item["action"], item.get("side")) for item in report["signatures"]] == EXPECTED_ACTIONS
    assert len({item["signature"] for item in report["signatures"]}) == 7
    assert report["oversizedDepositRejected"] is True
    assert report["beforeTokenAtoms"] == report["afterTokenAtoms"] == "1000000000"
    assert report["finalPortfolioCapital"] == "0" and report["makerCapital"] == "10000000000"
    assert report["genesisHash"]
    for name in BINARIES:
        pin = report["deployed"][name]
        assert pin["upgradeAuthority"] is None, "Test program authority was not finalized"
        assert len(pin["sha256"]) == 64 and pin["address"] and pin["programData"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--validator", required=True, type=Path)
    args = parser.parse_args()
    workspace, result, state = (p.resolve() for p in (args.workspace, args.output, args.state))
    assert not result.exists() and not state.exists(), "Preserve previous evidence; use fresh output/state paths"
    result.mkdir(parents=True)
    state.mkdir(parents=True, mode=0o700)
    summary = {"scope": "candidate-current-validator", "status": "incomplete"}
    try:
        for name in ("CARGO_TARGET_DIR", "PERCOLATOR_FUZZ_SBF", "SBF_OUT_PATH", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"):
            assert not os.environ.get(name), f"Unexpected build override: {name}"
        subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "protocol", "scripts/candidate_validator.py", "scripts/candidate_validator.mjs", "scripts/wrapper_qualification.py", "qualification"], cwd=ROOT, check=True)
        subprocess.run(["node", "protocol/check-source.mjs"], cwd=ROOT, check=True)
        config = qualification.load_manifest()
        assert config.get("overlay"), "This gate is for the reviewable candidate overlay"
        qualification.fetch(workspace, config)
        builder = qualification.output(["cargo", "+1.95.0", "build-sbf", "--version"])
        assert builder.startswith("cargo-build-sbf 4.6.0"), builder
        validator_version = qualification.output([str(args.validator.resolve()), "--version"])
        assert validator_version.startswith("solana-test-validator 4.4.1 "), validator_version
        for name, folder in (("program", "percolator-prog"), ("matcher", "percolator-prog/tests/fixtures/auth_matcher")):
            command = ["cargo", "+1.95.0", "build-sbf", "--tools-version", "v1.58", "--arch", "v3", "--sbf-out-dir", "target/localnet-deploy", "--", "--locked"]
            code, seconds = qualification.run_logged(command, workspace / folder, result / f"build-{name}.log", 1800)
            summary[f"build_{name}"] = {"exit_code": code, "seconds": seconds}
            assert code == 0, f"{name} build failed; see build-{name}.log"
        qualification.check_source(workspace, config)
        attestation = {
            "scope": "candidate-current-validator", "source": qualification.identity(config),
            "client_commit": qualification.output(["git", "rev-parse", "HEAD"], ROOT),
            "client_tree": qualification.output(["git", "rev-parse", "HEAD^{tree}"], ROOT),
            "candidate_runner_sha256": qualification.digest(__file__),
            "candidate_harness_sha256": qualification.digest(ROOT / "scripts/candidate_validator.mjs"),
            "toolchain": TOOLCHAIN, "reported_builder": builder, "reported_validator": validator_version,
            "binary_sha256": binary_hashes(workspace),
        }
        qualification.write_json(result / "attestation.json", attestation)
        command = ["node", str(ROOT / "scripts/candidate_validator.mjs"), str(args.validator.resolve()),
                   str(workspace / BINARIES["program"]), str(workspace / BINARIES["matcher"]), str(state), str(result / "attestation.json")]
        code, seconds = qualification.run_logged(command, ROOT, result / "lifecycle.log", 900)
        summary["lifecycle"] = {"exit_code": code, "seconds": seconds}
        assert code == 0, "Lifecycle failed or timed out; inspect lifecycle and validator logs"
        report = json.loads((state / "lifecycle-report.json").read_text())
        check_report(report, attestation)
        qualification.check_source(workspace, config)
        assert binary_hashes(workspace) == attestation["binary_sha256"], "Artifact changed during lifecycle"
        assert not (state / "deployment.json").exists(), "Qualification must not enroll a deployment profile"
        qualification.write_json(result / "lifecycle-report.json", report)
        summary.update(status="passed", identity=attestation)
    except Exception as error:
        summary["error"] = str(error)
        print(f"Candidate validator qualification failed: {error}", file=sys.stderr)
    finally:
        for source, target in ((state / "validator-output.log", "validator-output.log"), (state / "ledger/validator.log", "validator.log")):
            if source.is_file():
                (result / target).write_bytes(source.read_bytes())
        qualification.write_json(result / "summary.json", summary)
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
