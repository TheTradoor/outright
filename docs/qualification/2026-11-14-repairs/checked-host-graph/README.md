# Checked-host exhaustive graph result

The exact previously timed-out test passed in **540.362 seconds** with the
original 1,800-second limit. Its assertions require 11,727 public action words,
44,330 transitions and the complete original exact-state frontier. No test,
assertion, action, timeout or deployed SBF artifact was removed or weakened.

The source is the repaired wrapper base plus overlay from PR #25. Application
source `aa190c9d7c38d1a1d2e3bc0ce284602d2ed2e6f1` differs from the running PR
head `9191c8819ad683a7d8ffa49f831df5d90b99adb1` only in retained documentation.
The recorded identity includes the exact protocol bytes, qualification runner,
manifest, wrapper/matcher pins and overlay tree. The checked host artifact used
Rust 1.95.0, optimization level 1, debug assertions and overflow checks. The
compiler-reported profile is retained in `host-artifact.json`.

The four SBF hashes equal the complete earlier CI attempt and the new checked-host
CI build. Source, host executable and SBF identities were rechecked after the
passing test. The initial local invocation failed before executing its economic
checks because a compile-only target-directory override also redirected runtime
SBF lookup. That setup failure is retained. The rerun removed the override only
from the runtime environment and used the canonical, already-attested SBF paths;
no source or binary was changed.

This is one complete supplemental exact-test execution. The 342 filtered tests
are outside this command's scope. This result does not close the independent
37-shard aggregate, qualify later changed protocol bytes, test physical wallets,
or enable a production market. Complete build output, both invocations and all
relevant digests are retained here.
