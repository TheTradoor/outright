import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
import subprocess

SPEC = importlib.util.spec_from_file_location("qualification", Path(__file__).resolve().parents[1] / "wrapper_qualification.py")
q = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(q)


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.config = q.load_manifest()
        self.config["suites"] = {
            "v16_cu": {"shards": 2, "minimum_tests": 2},
            "v16_program_stateful_fuzz": {"shards": 2, "minimum_tests": 2},
        }
        self.config["cu_balance_weights"] = {"inv_a": 1, "inv_b": 1}
        self.config["cu_dependencies"] = {"inv_a": ["inv_b"]}
        self.reports = []
        for job in q.matrix(self.config):
            is_cu = job["suite"] == "v16_cu"
            modules = ["inv_a", "inv_b"] if is_cu else []
            owned = q.module_owners(modules, self.config)[job["index"]] if is_cu else []
            registered = ["inv_a::one", "inv_b::two"] if is_cu else ["one", "two", "three", "four"]
            assigned = q.assigned_names(registered, job["suite"], job["index"], self.config, modules, owned)
            self.reports.append({**q.identity(self.config), **job, "status": "complete",
                "registered": registered, "assigned": assigned,
                "results": [{"name": name, "passed": True, "exit_code": 0} for name in assigned],
                "modules": modules, "owned_modules": owned, "included_modules": modules,
                "sbf_hashes": {"program": "checked-digest"}})

    def test_complete_exact_coverage(self):
        result = q.verify_reports(self.reports, self.config)
        self.assertEqual(result["suites"]["v16_cu"]["passed"], 2)

    def test_missing_shard_fails(self):
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports[:-1], self.config)

    def test_duplicate_shard_fails(self):
        self.reports[-1] = copy.deepcopy(self.reports[0])
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_missing_test_fails(self):
        self.reports[0]["results"].clear()
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_failed_test_fails(self):
        self.reports[0]["results"][0]["passed"] = False
        self.reports[0]["results"][0]["exit_code"] = 101
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_interrupted_test_fails(self):
        self.reports[0]["status"] = "incomplete"
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_mixed_binary_fails(self):
        self.reports[0]["sbf_hashes"] = {"program": "other"}
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_unexecuted_dependency_test_fails(self):
        self.reports[0]["registered"].append("inv_b::added")
        with self.assertRaises(AssertionError):
            q.verify_reports(self.reports, self.config)

    def test_added_tests_are_executed_not_filtered_to_baseline(self):
        for report in self.reports[:2]:
            report["registered"].append("inv_b::added")
            assigned = q.assigned_names(report["registered"], "v16_cu", report["index"], self.config,
                                        report["modules"], report["owned_modules"])
            report["assigned"] = assigned
            report["results"] = [{"name": name, "passed": True, "exit_code": 0} for name in assigned]
        result = q.verify_reports(self.reports, self.config)
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


if __name__ == "__main__":
    unittest.main()
