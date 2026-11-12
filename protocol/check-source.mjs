import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = JSON.parse(
  readFileSync(new URL("./source-lock.json", import.meta.url)),
);
const contract = JSON.parse(
  readFileSync(new URL("./upstream-contract.json", import.meta.url)),
);
const paths = [
  "src",
  "Cargo.toml",
  "Cargo.lock",
  "spec.md",
  ".cargo",
  "build.rs",
];

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() || `Source check failed: git ${args.join(" ")}`,
    );
  return result.stdout.trim();
}

if (
  contract.engineCommit !== sources.engine.revision ||
  contract.wrapperCommit !== sources.program.revision
) {
  throw new Error(
    "Generated contract and source lock disagree. Review the source revisions before regenerating fixtures.",
  );
}
git(["cat-file", "-e", `${sources.engine.revision}^{commit}`]);
git(["diff", "--exit-code", sources.engine.revision, "--", ...paths]);
if (git(["ls-files", "--others", "--", ...paths])) {
  throw new Error(
    "Untracked engine source or configuration could change the compiled program.",
  );
}
console.log(`Engine source matches ${sources.engine.revision}.`);
