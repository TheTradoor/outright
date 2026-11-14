"""Verify retained PR #32 artifacts against the current qualification sources.

This checks downloaded evidence. It does not rerun tests or independently inspect
the 2,120 raw wrapper logs, which remain in the linked Actions run.
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
import candidate_validator as candidate
import wrapper_qualification as qualification


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


def verify():
    metadata = json.loads((HERE / "ci-verification.json").read_text())
    head = "da50d845f752f03e9f8b778854bf436a86b93da5"
    tested = "a4f4ebc0a9703011dc3f8fec12f6a0dd62218122"
    tree = "a53736b0d8a6282d16267832ef00b5006809faf8"
    assert metadata["head"] == head and metadata["tested_merge"] == tested
    assert metadata["published_merge"] == "9ea27452e3be6e141727d205f4a5aae8b028bedb"
    assert metadata["tested_and_published_tree"] == tree
    checks = metadata["checks"]
    assert len(checks) == len({check["id"] for check in checks}) == 51
    assert all(check["status"] == "completed" and check["conclusion"] == "success"
               and check["head_sha"] == head for check in checks)
    expected = {"outright_revision": tested, "tracked_worktree_dirty": False}
    config = qualification.load_manifest()
    identity = qualification.identity(config)
    archives = {}
    for item in metadata["artifacts"]:
        blob = (HERE / item["file"]).read_bytes()
        assert len(blob) == item["size_in_bytes"]
        assert "sha256:" + digest(blob) == item["digest"]
        assert item["workflow_run"]["head_sha"] == head
        assert item["name"] not in archives
        archives[item["name"]] = blob
    assert set(archives) == {"wrapper-programs", "wrapper-qualification-summary",
                             "candidate-current-validator"}

    with zipfile.ZipFile(io.BytesIO(archives["wrapper-programs"])) as archive:
        programs = json.loads(archive.read("artifacts.json"))
        with tarfile.open(fileobj=io.BytesIO(archive.read("sbf.tar.gz")), mode="r:gz") as binaries:
            hashes = {}
            for member in binaries.getmembers():
                assert member.isfile() and member.name not in hashes
                hashes[member.name] = digest(binaries.extractfile(member).read())
        assert hashes == programs["hashes"]
    with zipfile.ZipFile(io.BytesIO(archives["wrapper-qualification-summary"])) as archive:
        aggregate = json.loads(archive.read("wrapper-qualification.json"))
    assert aggregate == json.loads((HERE / "wrapper-qualification.json").read_text())
    assert aggregate["passed"] is True
    assert aggregate["identity"] == programs["identity"] == identity
    assert aggregate["candidate_source_metadata"] == programs["source_metadata"] == expected
    assert aggregate["sbf_hashes"] == programs["hashes"]
    for key in ("cargo_targets", "harnesses"):
        assert aggregate[key] == programs[key]
    ids = {shard["id"] for shard in qualification.matrix(config)}
    assert len(ids) == 37
    for key in ("tested_source_metadata", "program_source_metadata", "host_executable_sha256"):
        assert set(aggregate[key]) == ids
    for key in ("tested_source_metadata", "program_source_metadata"):
        assert all(source == expected for source in aggregate[key].values())
    assert all(re.fullmatch(r"[0-9a-f]{64}", value)
               for value in aggregate["host_executable_sha256"].values())
    assert set(aggregate["suites"]) == set(config["suites"])
    for name, suite in aggregate["suites"].items():
        assert suite["passed"] == len(suite["tests"]) == len(set(suite["tests"]))
        assert suite["passed"] >= config["suites"][name]["minimum_tests"]
    assert sum(suite["passed"] for suite in aggregate["suites"].values()) == 2120

    with zipfile.ZipFile(io.BytesIO(archives["candidate-current-validator"])) as archive:
        attestation = json.loads(archive.read("attestation.json"))
        report = json.loads(archive.read("lifecycle-report.json"))
        summary = json.loads(archive.read("summary.json"))
    assert attestation["source"] == identity
    assert attestation["client_commit"] == tested and attestation["client_tree"] == tree
    assert attestation["toolchain"] == candidate.TOOLCHAIN
    assert attestation["candidate_runner_sha256"] == qualification.digest(ROOT / "scripts/candidate_validator.py")
    assert attestation["candidate_harness_sha256"] == qualification.digest(ROOT / "scripts/candidate_validator.mjs")
    assert summary["status"] == "passed" and summary["identity"] == attestation
    assert all(summary[step]["exit_code"] == 0 for step in ("build_program", "build_matcher", "lifecycle"))
    candidate.check_report(report, attestation)
    assert all(report["deployed"][name]["sha256"] == value
               for name, value in attestation["binary_sha256"].items())
    files = identity["protocol_source"]["files"]
    assert len(files) == 73
    for item in files:
        blob = (ROOT / item["path"]).read_bytes()
        assert len(blob) == item["bytes"] and digest(blob) == item["sha256"]
    return {"checks_passed": 51, "artifact_digests_verified": 3,
            "wrapper_shards": 37, "wrapper_executions_in_aggregate": 2120,
            "wrapper_raw_logs_independently_verified": False,
            "candidate_protocol_files_verified": len(files),
            "candidate_lifecycle_transactions": len(report["signatures"]),
            "candidate_program_sha256": attestation["binary_sha256"]["program"],
            "source_and_binary_identities_match": True}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
