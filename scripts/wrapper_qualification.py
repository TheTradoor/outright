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


def identity(config):
    return {"wrapper": config["wrapper"], "matcher": config["matcher"],
            "overlay": config.get("overlay"),
            "engine_ref": config["engine_ref"], "manifest_sha256": digest(MANIFEST),
            "runner_sha256": digest(__file__)}


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
    report = {**identity(config), **shard, "status": "incomplete", "registered": [],
              "assigned": [], "results": [], "modules": [], "owned_modules": [],
              "included_modules": []}
    try:
        check_source(workspace, config)
        attestation = json.loads(artifacts.read_text())
        assert attestation["identity"] == identity(config), "Artifact/source identity mismatch"
        hashes = artifact_hashes(workspace)
        assert hashes == attestation["hashes"], "SBF artifact digest mismatch"
        report["sbf_hashes"] = hashes
        target = suite
        if suite == "v16_cu":
            target, modules, owned, included, generated_hash = cu_plan(wrapper, config, index)
            report.update(modules=modules, owned_modules=owned, included_modules=included,
                          harness_sha256=generated_hash)
        elif suite == "outright_native_lifecycle":
            source = ROOT / "protocol/svm/lifecycle.rs"
            destination = wrapper / "tests/outright_native_lifecycle.rs"
            if destination.exists():
                assert destination.read_bytes() == source.read_bytes()
            else:
                destination.write_bytes(source.read_bytes())
            report["harness_sha256"] = digest(source)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("PERCOLATOR_", "PROPTEST_"))
               and key not in ("CARGO_TARGET_DIR", "SBF_OUT_PATH", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS")}
        env.update(CARGO_BUILD_JOBS="1", CARGO_INCREMENTAL="0",
                   CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_TEST_DEBUG="0")
        if suite == "outright_native_lifecycle":
            env["OUTRIGHT_NATIVE_DRIVER"] = str(ROOT / "protocol/svm/driver.mjs")
        compile_log = result_dir / "compile.log"
        command = ["cargo", "+" + config["host_rust"], "rustc", "--locked", "--test", target,
                   "--message-format=json", "--", "-C", "debuginfo=0", "-C", "codegen-units=256"]
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
        check_source(workspace, config)
        assert artifact_hashes(workspace) == hashes, "Tests modified program artifacts"
        report["status"] = "complete"
    except Exception as error:
        report["error"] = str(error)
        print(f"{shard_id}: {error}", file=sys.stderr)
    write_json(result_dir / "result.json", report)
    return 0 if report["status"] == "complete" and all(r["passed"] for r in report["results"]) else 1


def verify_reports(reports, config):
    jobs = matrix(config)
    assert len(reports) == len(jobs), f"Missing/extra reports: {len(reports)} != {len(jobs)}"
    assert {r["id"] for r in reports} == {j["id"] for j in jobs}, "Duplicate/missing shards"
    for report in reports:
        assert {key: report[key] for key in ("id", "suite", "index")} in jobs, "Invalid shard identity"
    expected_identity = identity(config)
    hashes = None
    summary = {}
    for suite, settings in config["suites"].items():
        subset = sorted((r for r in reports if r["suite"] == suite), key=lambda r: r["index"])
        registered_union, executed = set(), []
        modules, owned_modules = set(), []
        full_listing = None
        for report in subset:
            assert {key: report[key] for key in expected_identity} == expected_identity, "Mixed source/runner identities"
            assert report["status"] == "complete", f'Incomplete shard {report["id"]}: {report.get("error")}'
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
    return {"identity": expected_identity, "sbf_hashes": hashes, "suites": summary, "passed": True}


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
        check_source(args.workspace.resolve(), config)
        write_json(args.output, {"identity": identity(config), "hashes": artifact_hashes(args.workspace.resolve())})
    elif args.command == "prepare":
        shard = next(j for j in matrix(config) if j["id"] == args.shard)
        print(json.dumps(cu_plan(args.workspace.resolve() / "percolator-prog", config, shard["index"])))
    elif args.command == "run":
        return run_shard(args.workspace.resolve(), config, args.shard, args.artifacts.resolve(), args.output.resolve())
    else:
        reports = [json.loads(path.read_text()) for path in sorted(args.reports.glob("**/result.json"))]
        summary = verify_reports(reports, config)
        write_json(args.output, summary)
        for suite, result in summary["suites"].items():
            print(f'{suite}: {result["passed"]} passed, exact execution coverage verified')
    return 0


if __name__ == "__main__":
    sys.exit(main())
