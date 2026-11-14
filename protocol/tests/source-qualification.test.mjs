import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("source gate rejects runtime, contract and qualification drift", () => {
  const root = mkdtempSync(join(tmpdir(), "outright-source-gate-"));
  try {
    mkdirSync(join(root, "protocol"));
    mkdirSync(join(root, "qualification"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/lib.rs"), "// source identity fixture\n");
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", "src");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture source");
    const revision = git("rev-parse", "HEAD");
    const tree = git("rev-parse", "HEAD^{tree}");
    copyFileSync(new URL("../check-source.mjs", import.meta.url), join(root, "protocol/check-source.mjs"));
    const baseline = {
      sources: { engine: { revision }, program: { repository: "https://github.com/owner/program", revision, tree } },
      contract: { engineCommit: revision, wrapperCommit: revision },
      qualification: { wrapper: { repository: "owner/program", ref: revision, tree }, engine_ref: revision },
    };
    const run = (data) => {
      for (const [path, value] of [
        ["protocol/source-lock.json", data.sources],
        ["protocol/upstream-contract.json", data.contract],
        ["qualification/wrapper-source.json", data.qualification],
      ]) writeFileSync(join(root, path), JSON.stringify(value));
      return spawnSync(process.execPath, [join(root, "protocol/check-source.mjs")], { cwd: root, encoding: "utf8" });
    };
    const valid = run(baseline);
    assert.equal(valid.status, 0, valid.stderr);
    const changes = [
      (d) => { d.qualification.wrapper.ref = "0".repeat(40); },
      (d) => { d.qualification.wrapper.repository = "other/program"; },
      (d) => { d.qualification.wrapper.tree = "0".repeat(40); },
      (d) => { d.qualification.engine_ref = "0".repeat(40); },
      (d) => { d.qualification.overlay = { path: "old.patch" }; },
      (d) => { delete d.qualification.wrapper.tree; delete d.sources.program.tree; },
      (d) => { d.contract.wrapperCommit = "0".repeat(40); },
    ];
    for (const change of changes) {
      const changed = structuredClone(baseline);
      change(changed);
      const rejected = run(changed);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /Runtime and qualification|Generated contract and source lock/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
