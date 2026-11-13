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
        self.identity = {"source": {"overlay": {"tree": "candidate-tree"}}}
        self.report = {
            "scope": "candidate-current-validator", "status": "passed", "network": "localnet",
            "identity": copy.deepcopy(self.identity), "genesisHash": "private-test-genesis",
            "signatures": [
                {"action": action, **({"side": side} if side else {}), "signature": str(index)}
                for index, (action, side) in enumerate(candidate.EXPECTED_ACTIONS)
            ],
            "oversizedDepositRejected": True, "beforeTokenAtoms": "1000000000", "afterTokenAtoms": "1000000000",
            "finalPortfolioCapital": "0", "makerCapital": "10000000000",
            "deployed": {name: {"upgradeAuthority": None, "sha256": "0" * 64, "address": name, "programData": name + "-data"} for name in candidate.BINARIES},
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

    def test_absent_oversized_deposit_check_rejected(self):
        self.report["oversizedDepositRejected"] = False
        self.reject()

    def test_public_network_rejected(self):
        self.report["network"] = "mainnet-beta"
        self.reject()


if __name__ == "__main__":
    unittest.main()
