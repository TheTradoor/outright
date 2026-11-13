#!/usr/bin/env python3
"""Run from percolator-prog at the exact qualified wrapper pin."""
from pathlib import Path
import hashlib
import re
import subprocess

WRAPPER_PIN = "357157e6e14d1d10ce78a995d5d50bb3c1f2ae13"
SOURCE_SHA256 = "105a5bf1734ac36ac68fab23f0a429c4f192c9e9ea97567b75d0708378ef5f1a"
OUTPUT_SHA256 = "efdc138f84e61a6b4cd956b3beb00aba7f8bc3d8e79d3d60ca58e8df192b2f37"
ENGINE_PIN = "a712af767eeb217876a3d3c50e3849b60ea54462"
assert subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == WRAPPER_PIN
source_path = Path("tests/v16_cu.rs")
source_bytes = source_path.read_bytes()
assert hashlib.sha256(source_bytes).hexdigest() == SOURCE_SHA256
assert ENGINE_PIN in Path("Cargo.lock").read_text()
source = source_bytes.decode()
pattern = r'#\[path = "invariants/cu/[^"\n]+"\]\nmod (inv_\w+);'
declarations = {match[1]: match.group() for match in re.finditer(pattern, source)}
selected = {
    "inv_045_no_free_mark_movement",
    "inv_072_order_robust_crankability",
    "inv_077_bounded_work_and_maximum_shape_compute",
}
fixtures = (
    "inv_018_quote_mint_vault_token_program_and_authority_integrity",
    "inv_081_success_state_validity_over_complete_public_routes",
)
assert len(declarations) == 87
assert selected | set(fixtures) <= declarations.keys()
output = re.sub(pattern, lambda match: match.group() if match[1] in selected else "", source)
fixture_block = (
    "\n// Retain the public SPL/native fixtures used transitively by INV-045 and INV-077.\n"
    "// All invariant test bodies continue to come from their original source files.\n"
    + "\n\n".join(declarations[name] for name in fixtures)
    + "\n"
)
assert output.count("mod support;\n") == 1
output = output.replace("mod support;\n", "mod support;\n" + fixture_block, 1)
assert hashlib.sha256(output.encode()).hexdigest() == OUTPUT_SHA256
assert len(list(re.finditer(pattern, output))) == 5
destination = Path("tests/outright_qualification_cu.rs")
if destination.exists():
    assert destination.read_text() == output, "Refusing to replace a different local harness"
else:
    destination.write_text(output)
print(f"Verified {destination}: five original invariant declarations; unchanged helper/assertion bodies")
