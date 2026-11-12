# Native Percolator client

JavaScript instruction builders and a portfolio reader for Outright's pinned
Percolator engine and Solana wrapper. The client constructs instruction bytes
and account metas. It does not store keys, sign transactions, request quotes,
or submit transactions.

The source revisions are recorded in [source-lock.json](source-lock.json).
The independent native adapter was developed in the earlier Tradoor Perps
workspace. Only its native protocol code is included here. No Pppercolator
terminal, simulator, exchange client, or launchpad code is imported.

## Verify the client

Use Node.js 22 or newer, Git, and the repository's pinned Rust toolchain. From
the repository root:

```sh
npm ci --prefix protocol --ignore-scripts --no-audit --no-fund
bash protocol/check.sh
```

The check compares the engine source with its recorded baseline, runs the Rust
conformance exporter, compares its output with the checked-in contract, and
runs the JavaScript regression tests. The exporter links the engine from this
checkout and the pinned wrapper. Cargo's patch configuration also directs the
wrapper's engine dependency to this checkout.

The exporter uses the wrapper's encoder, decoder, and account initializer.
Layout offsets come from Rust types. Change a source pin only after reviewing
the source diff, then regenerate the contract and inspect the differences.

[The SVM tests](svm/README.md) separately execute the JavaScript instructions
against a compiled SBF program and SPL Token. Host conformance alone does not
establish that a transaction executes correctly.

## Supported operations

| Operation | Support |
| --- | --- |
| Initialize portfolio | Instruction and account metas |
| Deposit and withdraw | Instruction and account metas |
| Bilateral trade | Instruction and account metas; both owners must sign |
| Matcher trade | Instruction and account metas; no arbitrary tail accounts |
| Permissionless crank | Wire encoding only; account planning is not implemented |
| Read portfolio | Identity, sequence, position epoch, raw capital and PnL, matcher flags |

All monetary and identity values use `bigint` or decimal integer strings.
`parseUnits` accepts plain decimal text and rejects rounding, scientific
notation, zero amounts, and values outside the SPL Token amount range.

```js
import { buildInstruction, parseUnits } from './protocol/src/instructions.mjs';

const instruction = buildInstruction(programId, 'deposit', {
  portfolioId: portfolioState.portfolioId,
  expectedSequence: portfolioState.expectedSequence,
  amount: parseUnits('10.25', 6),
}, { owner, market, portfolio, userToken, vault });
```

The example assumes the named addresses and portfolio state have been read and
verified. It produces an instruction, not a signed or submitted transaction.

## Transaction requirements

Portfolio initialization expects an allocated, rent-exempt, program-owned
account. Deposit and withdrawal token accounts must already have the correct
mint and authority. A transaction planner must verify these bindings and show
the intended amounts before requesting a signature.

`tradeNoCpi` requires both counterparties to sign. `tradeCpi` requires a funded
maker portfolio with matching onchain matcher authorization. Neither operation
creates liquidity. The matcher instruction is covered by wire-conformance and
account-meta tests; its execution is outside the current SVM lifecycle fixture.

A wallet application still needs fresh state, session binding, transaction
review, simulation, submission, and confirmation reconciliation. A decoded
portfolio does not establish solvency or withdrawable collateral.

## Read an account

```sh
node protocol/inspect.mjs <https-rpc-url> <expected-genesis-hash> <program-id> <market-address> <portfolio-address>
```

This command checks the RPC genesis hash, executable program, account ownership,
and portfolio identity at one confirmed account snapshot. It does not submit a
transaction. It rejects unsupported portfolio sizes and versions.

Executable-program and ownership checks do not verify deployed bytecode against
the source pin. Capital and PnL are raw engine units. Neither is a withdrawal
quote. Outright has no configured public deployment.
