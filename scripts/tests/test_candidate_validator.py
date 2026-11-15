import copy
import importlib.util
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("candidate_validator", SCRIPTS / "candidate_validator.py")
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)


class CandidateValidatorTests(unittest.TestCase):
    def setUp(self):
        self.identity = {
            "source": {"overlay": {"tree": "candidate-tree"}},
            "binary_sha256": {"program": "a" * 64, "matcher": "b" * 64},
        }
        self.report = {
            "scope": "candidate-current-validator", "status": "passed", "network": "localnet",
            "identity": copy.deepcopy(self.identity), "genesisHash": "private-test-genesis",
            "signatures": [
                {"action": action, **({"side": side} if side else {}), "signature": str(index)}
                for index, (action, side) in enumerate(candidate.EXPECTED_ACTIONS)
            ],
            "oversizedDepositRejected": True, "beforeTokenAtoms": "1000000000", "afterTokenAtoms": "1000000000",
            "finalPortfolioCapital": "0", "makerCapital": "10000000000",
            "deployed": {name: {"upgradeAuthority": None, "sha256": self.identity["binary_sha256"][name], "address": name, "programData": name + "-data"} for name in candidate.BINARIES},
        }

    def test_complete_report_accepted(self):
        candidate.check_report(self.report, self.identity)

    def reject(self):
        with self.assertRaises(AssertionError):
            candidate.check_report(self.report, self.identity)

    def test_interrupted_run_rejected(self):
        self.report["status"] = "incomplete"
        self.reject()

    def test_other_program_identity_rejected(self):
        self.report["identity"]["source"]["overlay"]["tree"] = "other-tree"
        self.reject()

    def test_missing_transaction_rejected(self):
        self.report["signatures"].pop()
        self.reject()

    def test_reused_transaction_rejected(self):
        self.report["signatures"][-1]["signature"] = self.report["signatures"][0]["signature"]
        self.reject()

    def test_incorrect_direction_rejected(self):
        self.report["signatures"][2]["side"] = "sell"
        self.reject()

    def test_collateral_loss_rejected(self):
        self.report["afterTokenAtoms"] = "999999999"
        self.reject()

    def test_leftover_portfolio_capital_rejected(self):
        self.report["finalPortfolioCapital"] = "1"
        self.reject()

    def test_maker_loss_rejected(self):
        self.report["makerCapital"] = "9999999999"
        self.reject()

    def test_mutable_program_rejected(self):
        self.report["deployed"]["program"]["upgradeAuthority"] = "test-admin"
        self.reject()

    def test_deployed_hash_must_match_each_build_artifact(self):
        for name in candidate.BINARIES:
            with self.subTest(binary=name):
                self.setUp()
                self.report["deployed"][name]["sha256"] = "f" * 64
                self.reject()

    def test_swapped_program_and_matcher_hashes_rejected(self):
        deployed = self.report["deployed"]
        deployed["program"]["sha256"], deployed["matcher"]["sha256"] = (
            deployed["matcher"]["sha256"], deployed["program"]["sha256"],
        )
        self.reject()

    def test_malformed_matching_hashes_rejected(self):
        for name in candidate.BINARIES:
            for value in ("g" * 64, "A" * 64, "a" * 63, "a" * 65, "a" * 64 + "\n", "", None, 123):
                with self.subTest(binary=name, value=value):
                    self.setUp()
                    self.identity["binary_sha256"][name] = value
                    self.report["identity"] = copy.deepcopy(self.identity)
                    self.report["deployed"][name]["sha256"] = value
                    self.reject()

    def test_missing_build_hashes_rejected(self):
        for missing in ("program", "matcher", "all"):
            with self.subTest(missing=missing):
                self.setUp()
                if missing == "all":
                    del self.identity["binary_sha256"]
                else:
                    del self.identity["binary_sha256"][missing]
                self.report["identity"] = copy.deepcopy(self.identity)
                self.reject()

    def test_extra_build_binary_rejected(self):
        self.identity["binary_sha256"]["unreviewed"] = "c" * 64
        self.report["identity"] = copy.deepcopy(self.identity)
        self.reject()

    def test_missing_or_extra_deployed_binary_rejected(self):
        for name in ("program", "matcher", "unreviewed"):
            with self.subTest(binary=name):
                self.setUp()
                if name == "unreviewed":
                    self.report["deployed"][name] = copy.deepcopy(self.report["deployed"]["program"])
                else:
                    del self.report["deployed"][name]
                self.reject()

    def test_absent_oversized_deposit_check_rejected(self):
        self.report["oversizedDepositRejected"] = False
        self.reject()

    def test_public_network_rejected(self):
        self.report["network"] = "mainnet-beta"
        self.reject()


if __name__ == "__main__":
    unittest.main()
