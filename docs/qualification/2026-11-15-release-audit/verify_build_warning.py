"""Recheck the warning location against the retained, unchanged program ELF.

This is a diagnostic for the recorded builder warning, not a runtime verifier.
The syscall registry was read from solana-define-syscall 5.4.0; its hashes were
crosschecked with the Rust implementation shipped in solana-sbpf 0.26.0.
"""
from pathlib import Path
import gzip
import hashlib
import json
import struct

HERE = Path(__file__).resolve().parent


def verify():
    record = json.loads((HERE / "build-warning-analysis.json").read_text())
    binary = gzip.decompress((HERE.parent / "2026-11-15-program-rebuild" /
                              "percolator_prog-sbpf-v3.so.gz").read_bytes())
    assert hashlib.sha256(binary).hexdigest() == record["binary_sha256"]
    assert len(binary) == record["binary_bytes"] == 1283424
    assert binary[:6] == b"\x7fELF\x02\x01"
    offset = struct.unpack_from("<Q", binary, 40)[0]
    width, count, strings_index = struct.unpack_from("<HHH", binary, 58)
    sections = [struct.unpack_from("<IIQQQQIIQQ", binary, offset + i * width)
                for i in range(count)]
    table = sections[strings_index]
    strings = binary[table[4]:table[4] + table[5]]
    sections = [{"name": strings[s[0]:].split(b"\0")[0].decode(),
                 "offset": s[4], "size": s[5], "flags": s[2]} for s in sections]
    known = {code: name for name, code in record["syscall_registry"].items()}
    assert len(known) == len(record["syscall_registry"]) == 44

    def scan(data, base=0):
        found = []
        position = 0
        while position + 8 <= len(data):
            opcode, registers, _, code = struct.unpack_from("<BBhI", data, position)
            if opcode == 0x85 and registers >> 4 == 0:
                found.append({"file_offset": base + position, "code": code,
                              "name": known.get(code)})
            position += 16 if opcode == 0x18 else 8
        return found

    invalid = next(call for call in scan(binary) if call["name"] is None)
    invalid["sections"] = [s["name"] for s in sections
                           if s["offset"] <= invalid["file_offset"] < s["offset"] + s["size"]]
    assert invalid == record["first_whole_file_invalid_syscall"]
    assert invalid["code"] == 9 and invalid["sections"] == [".rodata"]
    executable = [s for s in sections if s["flags"] & 4]
    assert executable == record["executable_sections"]
    calls = [call for s in executable
             for call in scan(binary[s["offset"]:s["offset"] + s["size"]], s["offset"])]
    assert len(calls) == record["executable_syscall_count"] == 14
    assert all(call["name"] is not None for call in calls)
    assert sorted({call["name"] for call in calls}) == record["executable_syscalls"]
    assert record["unrecognized_executable_syscalls"] == []
    assert record["program_changes"] is False
    return {"binary_sha256": record["binary_sha256"],
            "warning_file_offset": invalid["file_offset"], "warning_section": ".rodata",
            "executable_syscall_sites_checked": len(calls),
            "unrecognized_executable_syscalls": 0, "program_changed": False}


if __name__ == "__main__":
    print(json.dumps(verify(), indent=2))
