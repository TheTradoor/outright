# Contributing to Outright

Start with [PRODUCT.md](PRODUCT.md) for the delivery scope and
[docs/UPSTREAM.md](docs/UPSTREAM.md) for the engine baseline. Outright is in
development and has no supported production release.

## Reporting a problem

For a reproducible, non-sensitive bug, open an issue with the affected commit,
the command or action that triggered it, expected and actual behavior, and a
minimal reproduction. Include the Rust version and relevant logs.

Use [private security reporting](SECURITY.md) for vulnerabilities. Never include
private keys, seed phrases, RPC credentials or other secrets in an issue.

## Making a change

Keep each pull request focused on one problem. Describe what changes for the
caller or user, why the change is needed, and how it was checked. Mention
remaining limitations when they affect the result.

For a large feature or a change to risk behavior, open an issue before writing
the implementation so the expected behavior can be reviewed.

- Keep engine changes separate from application and documentation changes.
- Preserve upstream attribution, license notices and public API names.
- Explain any deviation from the pinned specification. Do not weaken an
  invariant, change rounding or alter a fixture merely to pass a test.
- Add regression coverage for changes to accounting, authorization, state
  transitions or custody. Documentation-only changes need link and content
  review.
- Use clear English in documentation, issues and pull requests. Prefer concrete
  behavior and evidence over promotional language.

## Verification

For Rust changes, run:

```sh
cargo test --locked
cargo test --locked --features fuzz
```

Changes to proof-relevant engine behavior also require the applicable Kani
checks described in [ENGINE.md](ENGINE.md). State exactly which checks ran and
which did not. A successful runtime test does not establish a proof result.

Keep generated logs, build output and credentials out of commits. Before
submitting, inspect `git diff --check` and the complete diff.

The pull request should be understandable without private chat history.
