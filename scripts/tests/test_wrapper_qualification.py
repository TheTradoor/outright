import copy
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("qualification", Path(__file__).resolve().parents[1] / "wrapper_qualification.py")
q = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(q)


class QualificationTests(unittest.TestCase):
    def commit(self, path, message="fixture"):
        subprocess.run(["git", "add", "."], cwd=path, check=True)
        subprocess.run(["git", "-c", "user.name=Qualification test", "-c",
                        "user.email=qualification@example.invalid", "commit", "-qm", message],
                       cwd=path, check=True)
        return q.output(["git", "rev-parse", "HEAD"], path)

    def setUp(self):
        self.config = q.load_manifest()
        self.config["suites"] = {
            "v16_cu": {"shards": 2, "minimum_tests": 2},
            "v16_program_stateful_fuzz": {"shards": 2, "minimum_tests": 2},
            "percolator_prog_lib": {"kind": "lib", "target": "percolator_prog", "shards": 1, "minimum_tests": 1},
        }
        self.config["separate_targets"] = [{"kind": "bin", "target": "v16-kani",
                                             "required_features": ["kani"], "reason": "Separate proof runner"}]
        self.config["cu_balance_weights"] = {"inv_a": 1, "inv_b": 1}
        self.config["cu_dependencies"] = {"inv_a": ["inv_b"]}
        self.config.pop("overlay", None)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.protocol_root = root / "outright"
        self.workspace = root / "workspace"
        wrapper = self.workspace / "percolator-prog"
        matcher = self.workspace / "percolator-match"
        for path in (self.protocol_root, wrapper, matcher):
            path.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(path)], check=True)
        (self.protocol_root / "protocol/svm").mkdir(parents=True)
        (self.protocol_root / "protocol/svm/lifecycle.rs").write_text("#[test] fn native() {}\n")
        (self.protocol_root / "protocol/svm/driver.mjs").write_text("export const driver = 1;\n")
        (self.protocol_root / "protocol/package-lock.json").write_text('{"lockfileVersion":3}\n')
        (self.protocol_root / "protocol/client.mjs").write_text("export const client = 1;\n")
        self.commit(self.protocol_root)
        root_patch = patch.object(q, "ROOT", self.protocol_root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        (wrapper / "tests").mkdir()
        (wrapper / "tests/v16_cu.rs").write_text(
            'fn helper() {}\n#[path = "invariants/cu/a.rs"]\nmod inv_a;\n'
            '#[path = "invariants/cu/b.rs"]\nmod inv_b;\n')
        (wrapper / "tests/v16_program_stateful_fuzz.rs").write_text("#[test] fn stateful() {}\n")
        (wrapper / "src").mkdir()
        (wrapper / "src/v16_program.rs").write_text("#[test] fn library() {}\n")
        (wrapper / "kani").mkdir()
        (wrapper / "kani/v16_kani.rs").write_text("fn main() {}\n")
        pin = self.config["engine_ref"]
        (wrapper / "Cargo.lock").write_text(f'git+https://github.com/aeyakovenko/percolator?rev={pin}#{pin}\n')
        self.config["wrapper"]["ref"] = self.commit(wrapper)
        (matcher / "README.md").write_text("matcher fixture\n")
        self.config["matcher"]["ref"] = self.commit(matcher)
        self.metadata = {"packages": [{"name": "percolator-prog", "version": "0.1.0",
            "manifest_path": str(wrapper / "Cargo.toml"),
            "features": {"default": ["anchor-v2"], "anchor-v2": ["dep:anchor-lang-v2"], "kani": []},
            "targets": [
                self.metadata_target("percolator_prog", "src/v16_program.rs", ["cdylib", "lib"]),
                self.metadata_target("v16_cu", "tests/v16_cu.rs", ["test"]),
                self.metadata_target("v16_program_stateful_fuzz", "tests/v16_program_stateful_fuzz.rs", ["test"]),
                self.metadata_target("v16-kani", "kani/v16_kani.rs", ["bin"], required=["kani"]),
                self.metadata_target("example", "examples/example.rs", ["example"], test=False),
            ]}]}
        metadata_patch = patch.object(q, "cargo_metadata", side_effect=self.metadata_result)
        metadata_patch.start()
        self.addCleanup(metadata_patch.stop)
        self.make_reports()

    def metadata_target(self, name, path, kind, test=True, required=()):
        return {"name": name, "kind": kind, "src_path": str(self.workspace / "percolator-prog" / path),
                "test": test, "doctest": "lib" in kind, "required-features": list(required)}

    def metadata_result(self, wrapper, config):
        metadata = copy.deepcopy(self.metadata)
        for source in (wrapper / "tests").glob("outright_*.rs"):
            metadata["packages"][0]["targets"].append(self.metadata_target(source.stem, f"tests/{source.name}", ["test"]))
        return metadata

    def make_reports(self):
        inventory = q.target_inventory(self.workspace, self.config)
        harnesses = q.canonical_harnesses(self.workspace, self.config, inventory)
        self.reports = []
        for job in q.matrix(self.config):
            is_cu = job["suite"] == "v16_cu"
            modules = ["inv_a", "inv_b"] if is_cu else []
            owned = q.module_owners(modules, self.config)[job["index"]] if is_cu else []
            included = q.cu_plan(self.workspace / "percolator-prog", self.config,
                                 job["index"], write=False)[3] if is_cu else []
            registered = ["inv_a::one", "inv_b::two"] if is_cu else ["one", "two", "three", "four"]
            if job["suite"] == "outright_native_lifecycle":
                registered = ["native"]
            elif job["suite"] == "percolator_prog_lib":
                registered = ["library"]
            assigned = q.assigned_names(registered, job["suite"], job["index"], self.config, modules, owned)
            self.reports.append({**q.identity(self.config), **job, "status": "complete",
                **harnesses[job["id"]], "harnesses": copy.deepcopy(harnesses),
                "cargo_targets": copy.deepcopy(inventory),
                "source_metadata": q.source_metadata(), "program_source_metadata": q.source_metadata(),
                "host_executable_sha256": "a" * 64,
                "registered": registered, "assigned": assigned,
                "results": [{"name": name, "passed": True, "exit_code": 0} for name in assigned],
                "modules": modules, "owned_modules": owned, "included_modules": included,
                "sbf_hashes": {"program": "checked-digest"}})

    def verify(self, reports=None):
        return q.verify_reports(self.reports if reports is None else reports, self.config, self.workspace)

    def test_missing_host_executable_digest_rejected(self):
        del self.reports[0]["host_executable_sha256"]
        with self.assertRaisesRegex(AssertionError, "Missing/malformed host executable digest"):
            self.verify()

    def test_malformed_host_executable_digest_rejected(self):
        for value in (None, 123, "", "not-a-hash", "a" * 63, "A" * 64):
            with self.subTest(value=value):
                self.reports[0]["host_executable_sha256"] = value
                with self.assertRaisesRegex(AssertionError, "Missing/malformed host executable digest"):
                    self.verify()

    def test_distinct_host_executable_digests_retained(self):
        self.reports[0]["host_executable_sha256"] = "b" * 64
        result = self.verify()
        self.assertEqual(result["host_executable_sha256"][self.reports[0]["id"]], "b" * 64)
        self.assertEqual(result["host_executable_sha256"][self.reports[1]["id"]], "a" * 64)

    def test_complete_exact_coverage(self):
        result = self.verify()
        self.assertEqual(result["suites"]["v16_cu"]["passed"], 2)

    def test_missing_shard_fails(self):
        with self.assertRaises(AssertionError):
            self.verify(self.reports[:-1])

    def test_duplicate_shard_fails(self):
        self.reports[-1] = copy.deepcopy(self.reports[0])
        with self.assertRaises(AssertionError):
            self.verify()

    def test_missing_test_fails(self):
        self.reports[0]["results"].clear()
        with self.assertRaises(AssertionError):
            self.verify()

    def test_failed_test_fails(self):
        self.reports[0]["results"][0]["passed"] = False
        self.reports[0]["results"][0]["exit_code"] = 101
        with self.assertRaises(AssertionError):
            self.verify()

    def test_interrupted_test_fails(self):
        self.reports[0]["status"] = "incomplete"
        with self.assertRaises(AssertionError):
            self.verify()

    def test_mixed_binary_fails(self):
        self.reports[0]["sbf_hashes"] = {"program": "other"}
        with self.assertRaises(AssertionError):
            self.verify()

    def test_unexecuted_dependency_test_fails(self):
        self.reports[0]["registered"].append("inv_b::added")
        with self.assertRaises(AssertionError):
            self.verify()

    def test_added_tests_are_executed_not_filtered_to_baseline(self):
        for report in self.reports[:2]:
            report["registered"].append("inv_b::added")
            assigned = q.assigned_names(report["registered"], "v16_cu", report["index"], self.config,
                                        report["modules"], report["owned_modules"])
            report["assigned"] = assigned
            report["results"] = [{"name": name, "passed": True, "exit_code": 0} for name in assigned]
        result = self.verify()
        self.assertEqual(result["suites"]["v16_cu"]["passed"], 3)

    def test_generator_preserves_original_and_transitive_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            wrapper = Path(directory)
            (wrapper / "tests").mkdir()
            text = 'fn helper() {}\n#[path = "invariants/cu/a.rs"]\nmod inv_a;\n#[path = "invariants/cu/b.rs"]\nmod inv_b;\n'
            source = wrapper / "tests/v16_cu.rs"
            source.write_text(text)
            target, modules, owned, included, _ = q.cu_plan(wrapper, self.config, 0)
            self.assertEqual(source.read_text(), text)
            self.assertEqual(included, ["inv_a", "inv_b"])
            self.assertEqual((wrapper / f"tests/{target}.rs").read_text(), text)

    def test_duplicate_or_empty_listing_rejected(self):
        for text in ("", "a: test\na: test", "a: benchmark"):
            with self.assertRaises(AssertionError):
                q.test_names(text)

    def test_ignored_untracked_cargo_configuration_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            subprocess.run(["git", "init", "-q", str(path)], check=True)
            (path / ".gitignore").write_text(".cargo/\n")
            subprocess.run(["git", "add", ".gitignore"], cwd=path, check=True)
            (path / ".cargo").mkdir()
            (path / ".cargo/config.toml").write_text('[build]\nrustflags = ["--cfg", "skip_checks"]\n')
            with self.assertRaisesRegex(AssertionError, "Unexpected untracked"):
                q.check_extra_files(path, "wrapper", self.config)

    def test_generated_harness_allowed_only_with_exact_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            subprocess.run(["git", "init", "-q", str(path)], check=True)
            (path / "tests").mkdir()
            (path / "tests/v16_cu.rs").write_text('#[path = "invariants/cu/a.rs"]\nmod inv_a;\n#[path = "invariants/cu/b.rs"]\nmod inv_b;\n')
            subprocess.run(["git", "add", "tests/v16_cu.rs"], cwd=path, check=True)
            name, *_ = q.cu_plan(path, self.config, 0)
            q.check_extra_files(path, "wrapper", self.config)
            (path / f"tests/{name}.rs").write_text("// dropped tests\n")
            with self.assertRaisesRegex(AssertionError, "Generated CU harness changed"):
                q.check_extra_files(path, "wrapper", self.config)

    def add_native_suite(self):
        self.config["suites"]["outright_native_lifecycle"] = {"shards": 1, "minimum_tests": 1}
        self.make_reports()

    def test_protocol_identity_covers_every_tracked_path_and_bytes(self):
        before = q.protocol_source()
        self.assertEqual({record["path"] for record in before["files"]}, {
            "protocol/client.mjs", "protocol/package-lock.json",
            "protocol/svm/lifecycle.rs", "protocol/svm/driver.mjs",
        })
        (self.protocol_root / "protocol/package-lock.json").write_text('{"lockfileVersion":4}\n')
        self.assertNotEqual(q.protocol_source()["sha256"], before["sha256"])

    def test_protocol_identity_binds_paths_as_well_as_identical_bytes(self):
        before = q.protocol_source()
        subprocess.run(["git", "mv", "protocol/client.mjs", "protocol/renamed.mjs"],
                       cwd=self.protocol_root, check=True)
        self.assertNotEqual(q.protocol_source()["sha256"], before["sha256"])

    def test_altered_native_driver_rejected(self):
        self.add_native_suite()
        (self.protocol_root / "protocol/svm/driver.mjs").write_text("export const driver = 2;\n")
        with self.assertRaisesRegex(AssertionError, "Mixed source/runner identities"):
            self.verify()

    def test_altered_native_lifecycle_rejected(self):
        self.add_native_suite()
        (self.protocol_root / "protocol/svm/lifecycle.rs").write_text("#[test] fn replacement() {}\n")
        with self.assertRaisesRegex(AssertionError, "Mixed source/runner identities"):
            self.verify()

    def test_mixed_protocol_source_rejected(self):
        self.reports[0]["protocol_source"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "Mixed source/runner identities"):
            self.verify()

    def test_altered_cu_harness_hash_rejected(self):
        self.reports[0]["harness_sha256"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "Noncanonical tested harness/driver"):
            self.verify()

    def test_matching_but_forged_harness_maps_rejected(self):
        for report in self.reports:
            report["harnesses"]["v16_cu-00"]["harness_sha256"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "Noncanonical harness/driver map"):
            self.verify()

    def test_altered_reported_driver_hash_rejected(self):
        self.add_native_suite()
        self.reports[-1]["driver_sha256"] = "0" * 64
        with self.assertRaisesRegex(AssertionError, "Noncanonical tested harness/driver"):
            self.verify()

    def test_canonical_harness_map_does_not_write_generated_sources(self):
        before = sorted((self.workspace / "percolator-prog/tests").iterdir())
        q.canonical_harnesses(self.workspace, self.config)
        self.assertEqual(sorted((self.workspace / "percolator-prog/tests").iterdir()), before)

    def test_docs_only_revision_reuses_identical_content_evidence(self):
        before_identity, before_metadata = q.identity(self.config), q.source_metadata()
        (self.protocol_root / "README.md").write_text("Documentation only\n")
        self.commit(self.protocol_root, "documentation")
        self.assertEqual(q.identity(self.config), before_identity)
        self.assertNotEqual(q.source_metadata()["outright_revision"], before_metadata["outright_revision"])
        result = self.verify()
        self.assertEqual(result["tested_source_metadata"]["v16_cu-00"], before_metadata)
        self.assertEqual(result["candidate_source_metadata"], q.source_metadata())

    def test_post_execution_protocol_change_rejected(self):
        before_identity = q.identity(self.config)
        inventory = q.target_inventory(self.workspace, self.config)
        harnesses = q.canonical_harnesses(self.workspace, self.config, inventory)
        (self.protocol_root / "protocol/client.mjs").write_text("export const client = 2;\n")
        with self.assertRaisesRegex(AssertionError, "source changed during execution"):
            q.check_unchanged_sources(self.workspace, self.config, before_identity, harnesses, inventory)

    def fixture_attestation(self):
        for name in q.ARTIFACTS:
            path = self.workspace / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"unit-test artifact: " + name.encode())
        return q.attest(self.workspace, self.config)

    def test_program_attestation_binds_all_canonical_harnesses_and_protocol(self):
        self.add_native_suite()
        attestation = self.fixture_attestation()
        self.assertEqual(attestation["identity"], q.identity(self.config))
        self.assertEqual(attestation["harnesses"], q.canonical_harnesses(self.workspace, self.config))
        self.assertEqual(attestation["source_metadata"], q.source_metadata())
        self.assertEqual(attestation["cargo_targets"], q.target_inventory(self.workspace, self.config))
        self.assertEqual(set(attestation["hashes"]), set(q.ARTIFACTS))

    def test_run_rejects_forged_attested_harness_map_before_compilation(self):
        attestation = self.fixture_attestation()
        attestation["harnesses"]["v16_cu-00"]["harness_sha256"] = "0" * 64
        path = self.workspace / "artifacts.json"
        q.write_json(path, attestation)
        destination = self.workspace / "results"
        with patch.object(q, "run_logged") as run, contextlib.redirect_stderr(io.StringIO()):
            code = q.run_shard(self.workspace, self.config, "v16_cu-00", path, destination)
        run.assert_not_called()
        self.assertEqual(code, 1)
        self.assertIn("canonical harness/driver map mismatch", (destination / "result.json").read_text())

    def test_uncovered_new_default_target_rejected(self):
        self.metadata["packages"][0]["targets"].append(self.metadata_target("new_suite", "tests/new_suite.rs", ["test"]))
        with self.assertRaisesRegex(AssertionError, "Default Cargo target coverage mismatch"):
            q.target_inventory(self.workspace, self.config)

    def test_missing_library_configuration_rejected(self):
        del self.config["suites"]["percolator_prog_lib"]
        with self.assertRaisesRegex(AssertionError, "Default Cargo target coverage mismatch"):
            q.target_inventory(self.workspace, self.config)

    def test_kani_cannot_be_excluded_if_default_feature_closure_enables_it(self):
        features = self.metadata["packages"][0]["features"]
        features["default"].append("proofs")
        features["proofs"] = ["kani"]
        with self.assertRaisesRegex(AssertionError, "Default Cargo target coverage mismatch"):
            q.target_inventory(self.workspace, self.config)

    def test_separate_kani_roster_cannot_hide_default_target(self):
        self.config["separate_targets"].append({"kind": "lib", "target": "percolator_prog",
            "required_features": [], "reason": "Invalid exclusion"})
        with self.assertRaisesRegex(AssertionError, "Separate target roster"):
            q.target_inventory(self.workspace, self.config)

    def test_missing_or_misdeclared_kani_roster_rejected(self):
        for separate in ([], [{"kind": "bin", "target": "v16-kani", "required_features": ["other"], "reason": "Wrong feature"}]):
            with self.subTest(separate=separate):
                self.config["separate_targets"] = separate
                with self.assertRaisesRegex(AssertionError, "Separate target roster"):
                    q.target_inventory(self.workspace, self.config)

    def test_exact_generated_harnesses_do_not_change_original_target_inventory(self):
        before = q.target_inventory(self.workspace, self.config)
        q.cu_plan(self.workspace / "percolator-prog", self.config, 0)
        self.assertEqual(q.target_inventory(self.workspace, self.config), before)

    def test_library_uses_standard_test_compile_and_source(self):
        self.assertEqual(q.compile_command(self.config, "lib", "percolator_prog"),
            ["cargo", "+1.95.0", "test", "--locked", "--lib", "--no-run", "--message-format=json"])
        harness = q.canonical_harnesses(self.workspace, self.config)["percolator_prog_lib-00"]
        self.assertEqual((harness["kind"], harness["target"], harness["source"]),
                         ("lib", "percolator_prog", "src/v16_program.rs"))

    def test_reported_target_inventory_cannot_disagree_with_candidate(self):
        self.reports[0]["cargo_targets"]["default_features"] = []
        with self.assertRaisesRegex(AssertionError, "Noncanonical Cargo target inventory"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
