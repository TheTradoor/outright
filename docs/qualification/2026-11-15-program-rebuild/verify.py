"""Check the retained rebuild against the qualified validator artifact."""
import copy
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PREVIOUS = HERE.parent / "2026-11-15-upstream-accounting"
sys.path.insert(0, str(ROOT / "scripts"))
import candidate_validator as candidate
import wrapper_qualification as qualification


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify():
    build = json.loads((HERE / "program-build-verification.json").read_text())
    config = qualification.load_manifest()
    assert build["source_commit"] == config["wrapper"]["ref"]
    assert build["source_tree"] == config["wrapper"]["tree"]
    assert build["engine_commit"] == config["engine_ref"]
    assert build["tracked_worktree_dirty_before"] is False
    assert build["tracked_worktree_dirty_after"] is False
    assert build["build_exit_code"] == 0
    assert build["toolchain"] == candidate.TOOLCHAIN
    assert build["command"] == ["cargo", "+1.95.0", "build-sbf", "--tools-version", "v1.58",
                                "--arch", "v3", "--sbf-out-dir", "target/release-candidate", "--", "--locked"]
    assert build["deployment"] is None and build["signing_keys_included"] is False
    binary = gzip.decompress((HERE / build["binary"]["path"]).read_bytes())
    assert len(binary) == build["binary"]["bytes"]
    assert digest(binary) == build["binary"]["sha256"]
    assert digest((HERE / "program-build.log").read_bytes()) == build["build_log_sha256"]

    metadata = json.loads((PREVIOUS / "ci-verification.json").read_text())
    item = next(a for a in metadata["artifacts"] if a["name"] == "candidate-current-validator")
    archive_path = PREVIOUS / item["file"]
    assert archive_path.stat().st_size == item["size_in_bytes"]
    assert "sha256:" + digest(archive_path.read_bytes()) == item["digest"]
    with zipfile.ZipFile(archive_path) as archive:
        attestation = json.loads(archive.read("attestation.json"))
        report = json.loads(archive.read("lifecycle-report.json"))
    assert attestation["source"] == qualification.identity(config)
    assert attestation["client_commit"] == metadata["tested_merge"]
    assert attestation["client_tree"] == metadata["tested_and_published_tree"]
    assert attestation["toolchain"] == build["toolchain"]
    for field, path in (("candidate_runner_sha256", "scripts/candidate_validator.py"),
                        ("candidate_harness_sha256", "scripts/candidate_validator.mjs")):
        recorded_source = subprocess.check_output(["git", "show", f"{metadata['head']}:{path}"], cwd=ROOT)
        assert digest(recorded_source) == attestation[field]
    candidate.check_report(report, attestation)
    assert build["binary"]["sha256"] == attestation["binary_sha256"]["program"]
    assert all(report["deployed"][name]["sha256"] == attestation["binary_sha256"][name]
               for name in candidate.BINARIES)
    for name in candidate.BINARIES:
        altered = copy.deepcopy(report)
        altered["deployed"][name]["sha256"] = "f" * 64
        try:
            candidate.check_report(altered, attestation)
        except AssertionError:
            pass
        else:
            raise AssertionError(f"Verifier accepted a substituted {name} hash")

    current = json.loads((HERE / "ci-verification.json").read_text())
    checks = current["checks"]
    assert len(checks) == len({check["id"] for check in checks}) == 5
    assert all(check["status"] == "completed" and check["conclusion"] == "success"
               and check["head_sha"] == current["head"] for check in checks)
    item = current["artifact"]
    archive_path = HERE / item["file"]
    assert archive_path.stat().st_size == item["size_in_bytes"]
    assert "sha256:" + digest(archive_path.read_bytes()) == item["digest"]
    assert item["workflow_run"]["head_sha"] == current["head"]
    with zipfile.ZipFile(archive_path) as archive:
        fresh_attestation = json.loads(archive.read("attestation.json"))
        fresh_report = json.loads(archive.read("lifecycle-report.json"))
        fresh_summary = json.loads(archive.read("summary.json"))
    assert fresh_attestation["source"] == attestation["source"]
    assert fresh_attestation["client_commit"] == current["tested_merge"]
    assert fresh_attestation["client_tree"] == current["tested_tree"]
    assert fresh_attestation["binary_sha256"] == attestation["binary_sha256"]
    assert fresh_attestation["toolchain"] == build["toolchain"]
    assert fresh_summary["status"] == "passed" and fresh_summary["identity"] == fresh_attestation
    assert all(fresh_summary[step]["exit_code"] == 0 for step in ("build_program", "build_matcher", "lifecycle"))
    assert fresh_attestation["candidate_runner_sha256"] == qualification.digest(ROOT / "scripts/candidate_validator.py")
    assert fresh_attestation["candidate_harness_sha256"] == qualification.digest(ROOT / "scripts/candidate_validator.mjs")
    candidate.check_report(fresh_report, fresh_attestation)
    published_changes = subprocess.check_output(
        ["git", "diff", "--name-only", current["head"], current["published_merge"]], cwd=ROOT, text=True,
    ).splitlines()
    assert all(path.startswith("docs/") for path in published_changes), "Published execution source differs from tested source"

    rent = json.loads((HERE / "mainnet-rent.json").read_text())
    assert rent["binary"] == {"bytes": len(binary), "sha256": digest(binary)}
    assert rent["genesisHash"] == "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    assert rent["signingPerformed"] is False and rent["transactionsSubmitted"] == 0
    assert rent["finalizedSlotAfter"] >= rent["finalizedSlotBefore"]
    contract = json.loads((ROOT / "protocol/upstream-contract.json").read_text())
    sizes = {"program": 36, "programData": len(binary) + 45, "uploadBuffer": len(binary) + 37,
             "market": contract["localnet"]["marketAccountLength"],
             "portfolio": contract["constants"]["portfolioLength"], "splTokenAccount": 165}
    assert len(rent["rows"]) == len(sizes)
    assert {row["name"]: row["bytes"] for row in rent["rows"]} == sizes
    assert all(type(row["rentLamports"]) is int and row["rentLamports"] > 0 for row in rent["rows"])
    return {"independent_build_matches_qualified_program": True,
            "program_bytes": len(binary), "program_sha256": digest(binary),
            "original_validator_report_accepted": True, "substituted_binary_hashes_rejected": 2,
            "fresh_ci_checks_passed": len(checks), "fresh_validator_transactions": len(fresh_report["signatures"]),
            "published_execution_source_matches_tested_source": True,
            "rent_account_sizes_checked": len(sizes), "production_deployment": None}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
