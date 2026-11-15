"""Verify retained PR #41 artifacts against the current qualification sources.

This checks downloaded evidence, including all 2,137 retained raw wrapper logs.
It does not rerun the Rust tests locally.
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
from verify_wrapper_packet import verify as verify_wrapper_packet


def digest(blob):
    return hashlib.sha256(blob).hexdigest()


def verify():
    metadata = json.loads((HERE / "ci-verification.json").read_text())
    head = "7fef978012ca24fee7468c8d35416f4b3d9f10a7"
    tested = "1cb3d8fff140f0594ddfcce7acea2ba724935ac3"
    tree = "315c274942622526cb0e9d644f13f0aa4bd44861"
    assert metadata["head"] == head and metadata["tested_merge"] == tested
    assert metadata["published_merge"] == "518eb3acfb9667aaa899eeb86835d0cd4f1020a5"
    assert metadata["program_published_merge"] == "162e73edb4f411d18907a9516e8c2808879935bc"
    assert metadata["program_tested_and_published_tree"] == "49f987d4963083b9befb3f92cf813fc656dcd02c"
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
    assert sum(suite["passed"] for suite in aggregate["suites"].values()) == 2137
    required_new_cases = ['v16_program_costliest_eight_leg_loss_over_24_liens_is_bounded_and_backs_every_gain', 'v16_program_costliest_eleven_leg_loss_over_6_liens_is_bounded_and_backs_every_gain', 'v16_program_costliest_nine_leg_loss_over_18_liens_is_bounded_and_backs_every_gain', 'v16_program_costliest_seven_leg_loss_over_27_liens_is_bounded_and_backs_every_gain', 'v16_program_costliest_ten_leg_loss_over_12_liens_is_bounded_and_backs_every_gain', 'v16_program_five_leg_loss_through_every_source_lien_is_bounded_and_backs_every_gain', 'v16_program_fourteen_leg_loss_over_claims_in_lapsed_domains_is_bounded', 'v16_program_fourteen_leg_loss_through_unliened_claims_at_the_source_cap_is_bounded', 'v16_program_live_insurance_exit_waits_for_unsettled_positions_on_its_asset', 'v16_program_live_provider_exit_is_empty_without_provider_principal', 'v16_program_live_provider_exit_leaves_the_loser_payment_for_the_winner', 'v16_program_one_leg_loss_through_every_source_lien_is_bounded_and_backs_the_gain', 'v16_program_six_leg_loss_through_leftover_source_liens_is_bounded_and_backs_every_gain', 'v16_program_source_lien_refresh_bound_refuses_a_batch_as_a_whole', 'v16_program_source_lien_refresh_bound_refuses_the_leg_past_it']
    cu_tests = aggregate["suites"]["v16_cu"]["tests"]
    for name in required_new_cases:
        assert sum(test.endswith("::" + name) for test in cu_tests) == 1, name
    native = aggregate["suites"]["outright_native_lifecycle"]
    assert native["passed"] == 19
    assert {"keeper_hybrid_funding_survives_feed_outage_and_settlement_cadence",
            "keeper_hybrid_fallback_requires_delay_and_trusted_feed"}.issubset(native["tests"])

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
    assert len(files) == 81
    for item in files:
        blob = (ROOT / item["path"]).read_bytes()
        assert len(blob) == item["bytes"] and digest(blob) == item["sha256"]
    packet = verify_wrapper_packet(HERE / "wrapper-evidence.tar.gz")
    assert packet["test_logs"] == 2137 and packet["artifacts"] == 39
    return {"checks_passed": 51, "artifact_digests_verified": 40,
            "wrapper_shards": 37, "wrapper_executions_in_aggregate": 2137,
            "wrapper_raw_logs_independently_verified": True,
            "candidate_protocol_files_verified": len(files),
            "candidate_lifecycle_transactions": len(report["signatures"]),
            "candidate_program_sha256": attestation["binary_sha256"]["program"],
            "source_and_binary_identities_match": True}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
