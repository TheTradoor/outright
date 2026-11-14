"""Verify retained CI identities, coverage records, binaries and raw test logs.

This checks the downloaded evidence; it does not rerun Rust or SBF tests.
Run from the repository root with Python 3. The current protocol/qualification
source must match the recorded client, or the identity comparison will reject.
"""
from pathlib import Path
import hashlib
import io
import json
import re
import sys
import tarfile
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import wrapper_qualification as qualification


def sha256(blob):
    return hashlib.sha256(blob).hexdigest()


def verify(packet):
    with tarfile.open(packet, "r:gz") as archive:
        files = {}
        for member in archive.getmembers():
            assert member.isfile(), "Unexpected packet member type"
            assert "/" not in member.name and member.name not in files
            files[member.name] = archive.extractfile(member).read()
    metadata = json.loads(files["artifacts.json"])
    assert len(metadata) == 39
    assert len({item["name"] for item in metadata}) == len(metadata)
    assert set(files) == {"artifacts.json"} | {a["name"] + ".zip" for a in metadata}
    config = qualification.load_manifest()
    identity = qualification.identity(config)
    expected_source = {
        "outright_revision": "450f51442a3bfc953b09b51f62c9c3607c2f5d92",
        "tracked_worktree_dirty": False,
    }
    reports = []
    log_count = 0
    aggregate = attestation = binaries = None
    for item in metadata:
        blob = files[item["name"] + ".zip"]
        assert len(blob) == item["size_in_bytes"]
        assert "sha256:" + sha256(blob) == item["digest"]
        with zipfile.ZipFile(io.BytesIO(blob)) as artifact:
            assert len(artifact.namelist()) == len(set(artifact.namelist()))
            if item["name"] == "wrapper-programs":
                attestation = json.loads(artifact.read("artifacts.json"))
                binaries = artifact.read("sbf.tar.gz")
            elif item["name"] == "wrapper-qualification-summary":
                aggregate = json.loads(artifact.read("wrapper-qualification.json"))
            else:
                assert item["name"].startswith("wrapper-result-")
                report = json.loads(artifact.read("result.json"))
                assert item["name"] == "wrapper-result-" + report["id"]
                assert report["status"] == "complete"
                assert report["source_metadata"] == expected_source
                assert report["program_source_metadata"] == expected_source
                assert {k: report[k] for k in identity} == identity
                assert report["assigned"] == [r["name"] for r in report["results"]]
                assigned = qualification.assigned_names(
                    report["registered"], report["suite"], report["index"],
                    config, report["modules"], report["owned_modules"],
                )
                assert report["assigned"] == assigned
                for result in report["results"]:
                    raw = artifact.read(result["log"])
                    assert result["passed"] and result["exit_code"] == 0
                    assert sha256(raw) == result["log_sha256"]
                    assert re.search(rb"test result: ok\. 1 passed; 0 failed; 0 ignored;", raw)
                    log_count += 1
                reports.append(report)
    assert attestation and aggregate and binaries
    assert attestation["identity"] == aggregate["identity"] == identity
    assert attestation["source_metadata"] == expected_source
    assert aggregate["passed"] is True
    assert aggregate["candidate_source_metadata"] == expected_source
    matrix = qualification.matrix(config)
    assert len(reports) == len(matrix) == 37
    assert {r["id"] for r in reports} == {j["id"] for j in matrix}
    assert len({r["id"] for r in reports}) == len(reports)
    for report in reports:
        assert {k: report[k] for k in ("id", "suite", "index")} in matrix
        assert report["sbf_hashes"] == attestation["hashes"] == aggregate["sbf_hashes"]
        assert report["harnesses"] == attestation["harnesses"] == aggregate["harnesses"]
        assert report["cargo_targets"] == attestation["cargo_targets"] == aggregate["cargo_targets"]
        assert aggregate["tested_source_metadata"][report["id"]] == expected_source
        assert aggregate["program_source_metadata"][report["id"]] == expected_source
        assert aggregate["host_executable_sha256"][report["id"]] == report["host_executable_sha256"]
        assert {k: report[k] for k in aggregate["harnesses"][report["id"]]} == aggregate["harnesses"][report["id"]]
    for suite, settings in config["suites"].items():
        subset = [r for r in reports if r["suite"] == suite]
        executed = [r["name"] for report in subset for r in report["results"]]
        assert len(executed) == len(set(executed)) >= settings["minimum_tests"]
        assert set(executed) == {name for report in subset for name in report["registered"]}
        assert aggregate["suites"][suite] == {"passed": len(executed), "tests": sorted(executed)}
    with tarfile.open(fileobj=io.BytesIO(binaries), mode="r:gz") as archive:
        hashes = {}
        for member in archive.getmembers():
            assert member.isfile() and member.name not in hashes
            hashes[member.name] = sha256(archive.extractfile(member).read())
        assert hashes == attestation["hashes"]
    assert log_count == sum(s["passed"] for s in aggregate["suites"].values()) == 2120
    return {"artifacts": len(metadata), "shards": len(reports), "test_logs": log_count,
            "source_identity_matches": True, "binary_digests_match": True,
            "aggregate_records_match": True, "rust_tests_rerun_locally": False}


if __name__ == "__main__":
    print(json.dumps(verify(HERE / "wrapper-evidence.tar.gz"), indent=2))
