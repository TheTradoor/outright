#!/usr/bin/env python3
"""Run every wrapper test once, preserving original test sources and failures."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "qualification/wrapper-source.json"
MOUNT = re.compile(r'#\[path = "(invariants/cu/[^"\n]+)"\]\s*mod (\w+);')
ARTIFACTS = (
    "percolator-prog/target/deploy/percolator_prog.so",
    "percolator-prog/tests/fixtures/auth_matcher/target/deploy/auth_matcher.so",
    "percolator-prog/tests/fixtures/hostile_matcher/target/deploy/hostile_matcher.so",
    "percolator-match/target/deploy/percolator_match.so",
)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def load_manifest():
    config = json.loads(MANIFEST.read_text())
    for source in (config["wrapper"], config["matcher"]):
        assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", source["repository"])
        assert re.fullmatch(r"[0-9a-f]{40}", source["ref"]), "Use immutable source commits"
    assert re.fullmatch(r"[0-9a-f]{40}", config["engine_ref"])
    overlay = config.get("overlay")
    if overlay:
        patch = (ROOT / overlay["path"]).resolve()
        assert patch.is_relative_to(ROOT)
        assert digest(patch) == overlay["sha256"], "Reviewed overlay digest mismatch"
        assert re.fullmatch(r"[0-9a-f]{40}", overlay["tree"])
    assert all(1 <= s["shards"] <= 32 for s in config["suites"].values())
    return config


def output(command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def check_source(workspace, config):
    for folder, key in (("percolator-prog", "wrapper"), ("percolator-match", "matcher")):
        path = workspace / folder
        assert output(["git", "rev-parse", "HEAD"], path) == config[key]["ref"]
        subprocess.run(["git", "diff", "--exit-code", "--quiet"], cwd=path, check=True)
        overlay = config.get("overlay") if key == "wrapper" else None
        expected_tree = overlay["tree"] if overlay else output(["git", "rev-parse", "HEAD^{tree}"], path)
        assert output(["git", "write-tree"], path) == expected_tree, f"Unexpected {folder} source tree"
        check_extra_files(path, key, config)
    lock = (workspace / "percolator-prog/Cargo.lock").read_text()
    assert f'git+https://github.com/aeyakovenko/percolator?rev={config["engine_ref"]}#{config["engine_ref"]}' in lock


def check_extra_files(path, key, config):
    ordinary = output(["git", "ls-files", "--others", "--exclude-standard"], path).splitlines()
    ignored = output(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "--",
                      ".cargo", "src", "build.rs", "Cargo*", "tests"], path).splitlines()
    for name in sorted(set(ordinary + ignored)):
        # Cargo build outputs are excluded, never source/configuration directories.
        if name.startswith(("target/", "tests/fixtures/auth_matcher/target/",
                            "tests/fixtures/hostile_matcher/target/")):
            continue
        match = re.fullmatch(r"tests/outright_qualification_cu_(\d{2})\.rs", name)
        if key == "wrapper" and match:
            index = int(match[1])
            assert index < config["suites"]["v16_cu"]["shards"]
            assert digest(path / name) == cu_plan(path, config, index, write=False)[4], "Generated CU harness changed"
        elif key == "wrapper" and name == "tests/outright_native_lifecycle.rs":
            assert digest(path / name) == digest(ROOT / "protocol/svm/lifecycle.rs"), "Native harness changed"
        else:
            raise AssertionError(f"Unexpected untracked source/configuration: {path / name}")


def fetch(workspace, config):
    workspace.mkdir(parents=True, exist_ok=True)
    for folder, key in (("percolator-prog", "wrapper"), ("percolator-match", "matcher")):
        path = workspace / folder
        assert not path.exists(), f"Refusing to replace existing checkout: {path}"
        subprocess.run(["git", "init", str(path)], check=True)
        subprocess.run(["git", "remote", "add", "origin", "https://github.com/" + config[key]["repository"] + ".git"], cwd=path, check=True)
        subprocess.run(["git", "fetch", "--no-tags", "--depth", "1", "origin", config[key]["ref"]], cwd=path, check=True)
        subprocess.run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=path, check=True)
        if key == "wrapper" and config.get("overlay"):
            patch = ROOT / config["overlay"]["path"]
            subprocess.run(["git", "apply", "--check", "--index", str(patch)], cwd=path, check=True)
            subprocess.run(["git", "apply", "--index", str(patch)], cwd=path, check=True)
    check_source(workspace, config)
    locks = sorted(workspace.glob("**/Cargo.lock"))
    lock_hash = hashlib.sha256(b"".join(p.read_bytes() for p in locks)).hexdigest()
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"lock_hash={lock_hash}\n")


def matrix(config):
    return [{"id": f"{suite}-{index:02d}", "suite": suite, "index": index}
            for suite, settings in config["suites"].items()
            for index in range(settings["shards"])]


def suite_target(suite, config):
    settings = config["suites"][suite]
    kind, target = settings.get("kind", "test"), settings.get("target", suite)
    assert kind in ("lib", "test", "bin", "example"), f"Unsupported test target kind: {kind}"
    if suite in ("v16_cu", "outright_native_lifecycle"):
        assert (kind, target) == ("test", suite), "Generated suite target cannot be remapped"
    return kind, target


def cargo_metadata(wrapper, config):
    # Called only after the pinned host toolchain is installed, never by fetch.
    return json.loads(output(["cargo", "+" + config["host_rust"], "metadata", "--locked",
                              "--no-deps", "--format-version", "1"], wrapper))


def default_features(features):
    enabled = {"default"} if "default" in features else set()
    while True:
        previous = enabled.copy()
        for name in previous:
            for member in features.get(name, []):
                if member in features:
                    enabled.add(member)
                elif "/" in member and "?/" not in member:
                    dependency = member.split("/", 1)[0]
                    # Strong dependency-feature syntax enables an implicit
                    # optional-dependency feature; namespaced/weak refs do not.
                    if features.get(dependency) == ["dep:" + dependency]:
                        enabled.add(dependency)
        if enabled == previous:
            return sorted(enabled)


def target_inventory(workspace, config):
    check_source(workspace, config)
    wrapper = (workspace / "percolator-prog").resolve()
    metadata = cargo_metadata(wrapper, config)
    packages = [package for package in metadata["packages"]
                if Path(package["manifest_path"]).resolve() == wrapper / "Cargo.toml"]
    assert len(packages) == 1, "Expected exactly the checked wrapper package"
    package = packages[0]
    enabled = default_features(package["features"])
    targets = []
    for target in package["targets"]:
        kinds = sorted(target["kind"])
        kind = "lib" if any(k in kinds for k in ("lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro")) else kinds[0]
        path = Path(target["src_path"]).resolve().relative_to(wrapper).as_posix()
        name = target["name"]
        required = sorted(target.get("required-features", []))
        generated = re.fullmatch(r"outright_qualification_cu_(\d{2})", name)
        if generated or name == "outright_native_lifecycle":
            assert (kind, path, target["test"], required) == ("test", f"tests/{name}.rs", True, []), "Unexpected generated target shape"
            assert not output(["git", "ls-files", "--", path], wrapper), "Reserved generated harness is tracked"
            if generated:
                index = int(generated[1])
                assert index < config["suites"]["v16_cu"]["shards"], "Unknown generated CU target"
                expected_hash = cu_plan(wrapper, config, index, write=False)[4]
            else:
                assert name in config["suites"], "Unconfigured generated native target"
                expected_hash = digest(ROOT / "protocol/svm/lifecycle.rs")
            assert digest(wrapper / path) == expected_hash, "Noncanonical generated Cargo target"
            continue
        targets.append({"kind": kind, "cargo_kinds": kinds, "target": name, "source": path,
                        "test": target["test"], "doctest": target.get("doctest", False),
                        "required_features": required,
                        "default_enabled": set(required) <= set(enabled)})
    targets.sort(key=lambda target: (target["kind"], target["target"]))
    keys = [(target["kind"], target["target"]) for target in targets]
    assert len(keys) == len(set(keys)), "Duplicate Cargo target identity"
    actual = {(target["kind"], target["target"]) for target in targets
              if target["test"] and target["default_enabled"]}
    configured = [suite_target(suite, config) for suite in config["suites"]
                  if suite != "outright_native_lifecycle"]
    assert len(configured) == len(set(configured)), "Duplicate configured Cargo test target"
    assert set(configured) == actual, f"Default Cargo target coverage mismatch: uncovered={sorted(actual - set(configured))}, unexpected={sorted(set(configured) - actual)}"
    disabled = {(target["kind"], target["target"]): target["required_features"]
                for target in targets if target["test"] and not target["default_enabled"]}
    separate = {}
    for target in config.get("separate_targets", []):
        key = (target["kind"], target["target"])
        assert key not in separate and target["reason"].strip(), "Duplicate/unexplained separate target"
        separate[key] = sorted(target["required_features"])
    assert separate == disabled, "Separate target roster must match only default-disabled required-feature targets"
    return {"package": package["name"], "version": package["version"],
            "default_features": enabled, "targets": targets,
            "scope": "default-feature unit and integration test targets; rustdoc and Kani proofs are separate"}


def module_owners(modules, config):
    # Weights affect scheduling only. Runtime discovery always includes new tests.
    count = config["suites"]["v16_cu"]["shards"]
    groups, loads = [[] for _ in range(count)], [0] * count
    weights = config["cu_balance_weights"]
    for name in sorted(modules, key=lambda name: (-weights.get(name, 1), name)):
        index = min(range(count), key=lambda index: (loads[index], index))
        groups[index].append(name)
        loads[index] += weights.get(name, 1)
    return [sorted(group) for group in groups]


def cu_plan(wrapper, config, index, write=True):
    source = (wrapper / "tests/v16_cu.rs").read_text()
    mounts = {match[2]: match.group() for match in MOUNT.finditer(source)}
    assert len(mounts) == len(list(MOUNT.finditer(source))) and mounts
    # Fail closed if formatting changes leave any invariant mount unrecognized.
    assert len(mounts) == len(re.findall(r"\bmod\s+inv_\w+\s*;", source))
    modules = sorted(mounts)
    owned = module_owners(modules, config)[index]
    included = set(owned)
    dependencies = config["cu_dependencies"]
    assert set(dependencies) <= set(modules), "Update dependency map for changed source modules"
    while True:
        before = included.copy()
        for name in before:
            included.update(dependencies.get(name, []))
        if before == included:
            break
    assert included <= set(modules)
    generated = MOUNT.sub(lambda match: match.group() if match[2] in included else "", source)
    name = f"outright_qualification_cu_{index:02d}"
    destination = wrapper / f"tests/{name}.rs"
    if write:
        if destination.exists():
            assert destination.read_text() == generated, "Refusing to replace another generated harness"
        else:
            destination.write_text(generated)
    return name, modules, owned, sorted(included), hashlib.sha256(generated.encode()).hexdigest()


def artifact_hashes(workspace):
    return {name: digest(workspace / name) for name in ARTIFACTS}


def protocol_source():
    """Bind sorted tracked paths and their actual bytes, independent of Git revision."""
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "protocol/"], cwd=ROOT,
    ).split(b"\0")
    names = sorted(name for name in names if name)
    assert names and len(names) == len(set(names)), "Missing/duplicate tracked protocol files"
    checksum = hashlib.sha256(b"outright-protocol-source-v1\0")
    files = []
    for encoded_name in names:
        name = encoded_name.decode("utf-8")
        path = ROOT / name
        assert path.is_file() and not path.is_symlink(), f"Expected tracked regular file: {name}"
        content = path.read_bytes()
        checksum.update(len(encoded_name).to_bytes(8, "big"))
        checksum.update(encoded_name)
        checksum.update(len(content).to_bytes(8, "big"))
        checksum.update(content)
        files.append({"path": name, "bytes": len(content),
                      "sha256": hashlib.sha256(content).hexdigest()})
    return {"sha256": checksum.hexdigest(), "files": files}


def source_metadata():
    # Revision is evidence metadata, not content identity: docs-only successors
    # can verify prior results while preserving which revision actually ran them.
    return {"outright_revision": output(["git", "rev-parse", "HEAD"], ROOT),
            "tracked_worktree_dirty": bool(output(["git", "status", "--porcelain", "--untracked-files=no"], ROOT))}


def canonical_harnesses(workspace, config, inventory=None):
    wrapper = workspace / "percolator-prog"
    inventory = target_inventory(workspace, config) if inventory is None else inventory
    sources = {(target["kind"], target["target"]): target["source"] for target in inventory["targets"]}
    harnesses = {}
    for shard in matrix(config):
        suite = shard["suite"]
        kind, target = suite_target(suite, config)
        driver_hash = None
        if suite == "v16_cu":
            target, _, _, _, harness_hash = cu_plan(wrapper, config, shard["index"], write=False)
            source_path = f"tests/{target}.rs"
        elif suite == "outright_native_lifecycle":
            harness_hash = digest(ROOT / "protocol/svm/lifecycle.rs")
            driver_hash = digest(ROOT / "protocol/svm/driver.mjs")
            source_path = "tests/outright_native_lifecycle.rs"
        else:
            source_path = sources[(kind, target)]
            harness_hash = digest(wrapper / source_path)
        harnesses[shard["id"]] = {"kind": kind, "target": target, "source": source_path,
                                  "harness_sha256": harness_hash, "driver_sha256": driver_hash}
    return harnesses


def identity(config):
    return {"wrapper": config["wrapper"], "matcher": config["matcher"],
            "overlay": config.get("overlay"),
            "engine_ref": config["engine_ref"], "manifest_sha256": digest(MANIFEST),
            "runner_sha256": digest(__file__), "protocol_source": protocol_source()}


def check_unchanged_sources(workspace, config, expected_identity, harnesses, inventory):
    check_source(workspace, config)
    assert identity(config) == expected_identity, "Protocol/qualification source changed during execution"
    current_inventory = target_inventory(workspace, config)
    assert current_inventory == inventory, "Cargo target inventory changed"
    assert canonical_harnesses(workspace, config, current_inventory) == harnesses, "Canonical harness/driver map changed"


def attest(workspace, config):
    check_source(workspace, config)
    expected_identity = identity(config)
    inventory = target_inventory(workspace, config)
    harnesses = canonical_harnesses(workspace, config, inventory)
    hashes = artifact_hashes(workspace)
    check_unchanged_sources(workspace, config, expected_identity, harnesses, inventory)
    return {"identity": expected_identity, "source_metadata": source_metadata(),
            "cargo_targets": inventory, "harnesses": harnesses, "hashes": hashes}


def compile_command(config, kind, target):
    command = ["cargo", "+" + config["host_rust"]]
    if kind == "lib":
        return command + ["test", "--locked", "--lib", "--no-run", "--message-format=json"]
    return command + ["rustc", "--locked", "--" + kind, target,
                      "--message-format=json", "--", "-C", "debuginfo=0", "-C", "codegen-units=256"]


def run_logged(command, cwd, log, timeout, env=None):
    start = time.monotonic()
    with open(log, "w") as stream:
        process = subprocess.Popen(command, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                   env=env, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            stream.write(f"\nQUALIFICATION TIMEOUT after {timeout} seconds\n")
            code = 124
    return code, round(time.monotonic() - start, 3)


def test_names(text):
    lines = [line for line in text.splitlines() if line.strip()]
    assert lines and all(line.endswith(": test") for line in lines), "Unexpected or empty test listing"
    names = [line.removesuffix(": test") for line in lines]
    assert len(names) == len(set(names)), "Duplicate registered test names"
    return sorted(names)


def assigned_names(registered, suite, index, config, modules, owned):
    if suite == "v16_cu":
        return [name for name in registered if name.split("::")[0] in owned
                or (index == 0 and name.split("::")[0] not in modules)]
    count = config["suites"][suite]["shards"]
    return [name for name in registered
            if int(hashlib.sha256(name.encode()).hexdigest(), 16) % count == index]


def run_shard(workspace, config, shard_id, artifacts, result_dir):
    shard = next(item for item in matrix(config) if item["id"] == shard_id)
    suite, index = shard["suite"], shard["index"]
    wrapper = workspace / "percolator-prog"
    result_dir.mkdir(parents=True, exist_ok=True)
    expected_identity = identity(config)
    report = {**expected_identity, **shard, "source_metadata": source_metadata(),
              "status": "incomplete", "registered": [],
              "assigned": [], "results": [], "modules": [], "owned_modules": [],
              "included_modules": []}
    try:
        check_source(workspace, config)
        inventory = target_inventory(workspace, config)
        harnesses = canonical_harnesses(workspace, config, inventory)
        attestation = json.loads(artifacts.read_text())
        assert attestation["identity"] == expected_identity, "Artifact/source identity mismatch"
        assert attestation["cargo_targets"] == inventory, "Artifact Cargo target inventory mismatch"
        assert attestation["harnesses"] == harnesses, "Artifact canonical harness/driver map mismatch"
        report["harnesses"] = harnesses
        report["cargo_targets"] = inventory
        report["program_source_metadata"] = attestation["source_metadata"]
        report.update(harnesses[shard_id])
        hashes = artifact_hashes(workspace)
        assert hashes == attestation["hashes"], "SBF artifact digest mismatch"
        report["sbf_hashes"] = hashes
        target = report["target"]
        if suite == "v16_cu":
            target, modules, owned, included, generated_hash = cu_plan(wrapper, config, index)
            assert target == report["target"] and generated_hash == report["harness_sha256"], "Generated CU plan differs from canonical map"
            report.update(modules=modules, owned_modules=owned, included_modules=included)
        elif suite == "outright_native_lifecycle":
            source = ROOT / "protocol/svm/lifecycle.rs"
            destination = wrapper / "tests/outright_native_lifecycle.rs"
            if destination.exists():
                assert destination.read_bytes() == source.read_bytes()
            else:
                destination.write_bytes(source.read_bytes())
        assert digest(wrapper / report["source"]) == report["harness_sha256"], "Test harness differs from canonical source"
        check_unchanged_sources(workspace, config, expected_identity, harnesses, inventory)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("PERCOLATOR_", "PROPTEST_"))
               and key not in ("CARGO_TARGET_DIR", "SBF_OUT_PATH", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS")}
        env.update(CARGO_BUILD_JOBS="1", CARGO_INCREMENTAL="0",
                   CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_TEST_DEBUG="0",
                   CARGO_PROFILE_TEST_CODEGEN_UNITS="256")
        if suite == "outright_native_lifecycle":
            env["OUTRIGHT_NATIVE_DRIVER"] = str(ROOT / "protocol/svm/driver.mjs")
        compile_log = result_dir / "compile.log"
        command = compile_command(config, report["kind"], target)
        code, elapsed = run_logged(command, wrapper, compile_log, config["compile_timeout_seconds"], env)
        report["compile"] = {"command": command, "exit_code": code, "seconds": elapsed}
        assert code == 0, f"Host compilation failed ({code}); see compile.log"
        binaries = []
        for line in compile_log.read_text().splitlines():
            if not line.startswith("{"):
                continue
            record = json.loads(line)
            if record.get("reason") == "compiler-artifact" and record.get("target", {}).get("name") == target and record.get("executable"):
                binaries.append(record["executable"])
        assert len(binaries) == 1, f"Expected one test binary, received {binaries}"
        binary = binaries[0]
        report["host_executable_sha256"] = digest(binary)
        registered = test_names(output([binary, "--list", "--format", "terse"], wrapper))
        report["registered"] = registered
        assigned = assigned_names(registered, suite, index, config, report["modules"], report["owned_modules"])
        report["assigned"] = assigned
        assert assigned, "Empty test shard"
        for number, name in enumerate(assigned):
            log = result_dir / f"test-{number:04d}.log"
            command = [binary, name, "--exact", "--include-ignored", "--nocapture", "--test-threads=1"]
            code, elapsed = run_logged(command, wrapper, log, config["test_timeout_seconds"], env)
            text = log.read_text(errors="replace")
            passed = code == 0 and re.search(r"test result: ok\. 1 passed; 0 failed; 0 ignored;", text) is not None
            report["results"].append({"name": name, "passed": passed, "exit_code": code,
                                      "seconds": elapsed, "log": log.name, "log_sha256": digest(log)})
            print(f'{shard_id} {number + 1}/{len(assigned)} {"PASS" if passed else "FAIL"} {name}', flush=True)
            write_json(result_dir / "result.json", report)
        check_unchanged_sources(workspace, config, expected_identity, harnesses, inventory)
        assert artifact_hashes(workspace) == hashes, "Tests modified program artifacts"
        assert digest(binary) == report["host_executable_sha256"], "Tests modified host test executable"
        report["status"] = "complete"
    except Exception as error:
        report["error"] = str(error)
        print(f"{shard_id}: {error}", file=sys.stderr)
    write_json(result_dir / "result.json", report)
    return 0 if report["status"] == "complete" and all(r["passed"] for r in report["results"]) else 1


def verify_reports(reports, config, workspace):
    check_source(workspace, config)
    jobs = matrix(config)
    assert len(reports) == len(jobs), f"Missing/extra reports: {len(reports)} != {len(jobs)}"
    assert {r["id"] for r in reports} == {j["id"] for j in jobs}, "Duplicate/missing shards"
    for report in reports:
        assert {key: report[key] for key in ("id", "suite", "index")} in jobs, "Invalid shard identity"
    expected_identity = identity(config)
    inventory = target_inventory(workspace, config)
    harnesses = canonical_harnesses(workspace, config, inventory)
    hashes = None
    summary = {}
    for suite, settings in config["suites"].items():
        subset = sorted((r for r in reports if r["suite"] == suite), key=lambda r: r["index"])
        registered_union, executed = set(), []
        modules, owned_modules = set(), []
        full_listing = None
        for report in subset:
            assert {key: report[key] for key in expected_identity} == expected_identity, "Mixed source/runner identities"
            assert report["cargo_targets"] == inventory, "Noncanonical Cargo target inventory"
            assert report["harnesses"] == harnesses, "Noncanonical harness/driver map"
            assert {key: report[key] for key in harnesses[report["id"]]} == harnesses[report["id"]], "Noncanonical tested harness/driver"
            assert report["status"] == "complete", f'Incomplete shard {report["id"]}: {report.get("error")}'
            executable_hash = report.get("host_executable_sha256")
            assert isinstance(executable_hash, str) and re.fullmatch(r"[0-9a-f]{64}", executable_hash), "Missing/malformed host executable digest"
            if hashes is None:
                hashes = report["sbf_hashes"]
            assert report["sbf_hashes"] == hashes, "Mixed SBF artifacts"
            registered = report["registered"]
            assert len(registered) == len(set(registered))
            assigned = assigned_names(registered, suite, report["index"], config, report["modules"], report["owned_modules"])
            assert report["assigned"] == assigned, "Incorrect shard assignment"
            assert [r["name"] for r in report["results"]] == assigned, "Skipped, reordered or duplicate test execution"
            assert all(r["passed"] and r["exit_code"] == 0 for r in report["results"]), f'Failed tests in {report["id"]}'
            registered_union.update(registered)
            executed.extend(r["name"] for r in report["results"])
            if suite == "v16_cu":
                _, canonical_modules, canonical_owned, canonical_included, _ = cu_plan(
                    workspace / "percolator-prog", config, report["index"], write=False,
                )
                assert report["modules"] == canonical_modules, "Noncanonical source module inventory"
                assert report["owned_modules"] == canonical_owned, "Noncanonical module ownership"
                assert report["included_modules"] == canonical_included, "Noncanonical harness module closure"
                if modules:
                    assert set(report["modules"]) == modules, "Different source module inventories"
                modules = set(report["modules"])
                expected_owned = module_owners(sorted(modules), config)[report["index"]]
                assert report["owned_modules"] == expected_owned, "Incomplete module ownership"
                assert set(expected_owned) <= set(report["included_modules"])
                owned_modules.extend(report["owned_modules"])
            else:
                if full_listing is not None:
                    assert registered == full_listing, "Full-suite listings disagree"
                full_listing = registered
        assert len(executed) == len(set(executed)), f"Duplicate executions in {suite}"
        assert set(executed) == registered_union, f"Unexecuted registered tests in {suite}"
        assert len(executed) >= settings["minimum_tests"], f"Unexpected test count reduction in {suite}"
        if suite == "v16_cu":
            assert len(owned_modules) == len(set(owned_modules)) and set(owned_modules) == modules
        summary[suite] = {"passed": len(executed), "tests": sorted(executed)}
    check_unchanged_sources(workspace, config, expected_identity, harnesses, inventory)
    return {"identity": expected_identity, "candidate_source_metadata": source_metadata(),
            "tested_source_metadata": {report["id"]: report["source_metadata"] for report in reports},
            "program_source_metadata": {report["id"]: report["program_source_metadata"] for report in reports},
            "host_executable_sha256": {report["id"]: report["host_executable_sha256"] for report in reports},
            "cargo_targets": inventory, "harnesses": harnesses,
            "sbf_hashes": hashes, "suites": summary, "passed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["matrix", "fetch", "attest", "prepare", "run", "aggregate"])
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--shard")
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--reports", type=Path)
    args = parser.parse_args()
    config = load_manifest()
    if args.command == "matrix":
        value = json.dumps({"include": matrix(config)}, separators=(",", ":"))
        print(value)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
                stream.write("matrix=" + value + "\n")
    elif args.command == "fetch":
        fetch(args.workspace.resolve(), config)
    elif args.command == "attest":
        write_json(args.output, attest(args.workspace.resolve(), config))
    elif args.command == "prepare":
        shard = next(j for j in matrix(config) if j["id"] == args.shard)
        print(json.dumps(cu_plan(args.workspace.resolve() / "percolator-prog", config, shard["index"])))
    elif args.command == "run":
        return run_shard(args.workspace.resolve(), config, args.shard, args.artifacts.resolve(), args.output.resolve())
    else:
        assert args.workspace is not None, "aggregate requires --workspace with the exact candidate checkout"
        reports = [json.loads(path.read_text()) for path in sorted(args.reports.glob("**/result.json"))]
        summary = verify_reports(reports, config, args.workspace.resolve())
        write_json(args.output, summary)
        for suite, result in summary["suites"].items():
            print(f'{suite}: {result["passed"]} passed, exact execution coverage verified')
    return 0


if __name__ == "__main__":
    sys.exit(main())
