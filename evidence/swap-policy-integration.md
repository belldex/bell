# M05-05 swap policy integration — partial, blocked

Status: **BLOCKED_DEPENDENCY**, not DONE. **Production swaps remain disabled.** No RPC,
credentials, `.env` changes, broadcasts, production deployments or source-rights claims were used.

## What is implemented

- `BellModeEvaluator`, already constructed and immutably bound by each hook, now transports pure swap
  arithmetic as well as the existing mode decision. Calls use STATICCALL, not delegatecall. It has no
  state, setters, executor address or authority to authorize swaps.
- The internal `SwapEvaluation` types distinguish trusted caller-collected context from calculated
  snapshot/results. `prepare` composes the locked session/BELL/corporate/repricing maximum fee and
  minimum trade/window caps, with floor cap rounding and ceil BELL fee rounding.
- `settle` checks snapshot consistency, callback binding and same-transaction timestamp; widens signed
  deltas before negation, checks direction and exact-input/output fill bounds, rejects zero/fee-only
  fills, applies the existing normative wide price-path comparison, and returns rolling **and** episode
  candidates together. It does not mutate hook storage or trust arbitrary hookData.
- SESSION_ONLY arithmetic never creates a reference or advertises a price band. PRICE_GUARDED
  arithmetic requires nonzero references, valid decimals, and the exact 200/500 bps policy band.
- The actual `BellHook` now explicitly rejects nonempty swap hookData with `ContextMismatch`, after
  its existing manager/key gates. Empty-data swaps retain the existing fail-closed policy gate.
- Dependency/config validation now precedes construction of the larger immutable evaluator. This
  preserves the existing bounded-gas malformed-manager rejection test without increasing its gas
  allowance. The factory test salt miner reuses fixed ABI/CREATE2 preimage buffers instead of
  accumulating per-iteration memory; its salt namespace, permission mask and 200,000-attempt bound
  are unchanged. This is test-only mining, not a change to factory salts or production guards.

## What the tests do and do not establish

`CoreSwapPolicy.t.sol` uses the real pinned Uniswap PoolManager, actual core BalanceDelta and slot0,
real ERC20 settlement, and a **test-only** snapshot hook at a permission-correct address. That fixture
accepts synthetic context through an unrestricted test setter and uses test-only code etching. It is
not BellHook, source admission, a deployable candidate, or evidence that production trading works.

The fixture pins its context before core execution, binds sender/key/SwapParams, evaluates actual
core results after execution, and writes both accounting candidates only after all checks pass.
Reverted core/unlock/settlement calls restore its snapshot, price, both currency counters and balances.
Coverage includes:

- exact input/output in both currency directions; partial exact input/output; crossing an initialized
  tick; protocol fee enabled, including the input fee in gross;
- zero-output fee-only fill; arbitrary hookData; invalid normal path; corrective repricing that can
  progress while still out of band; rejecting the opposite direction without blocking correction;
- second-currency closure-cap failure; both closure gross commits; rolling rejection without refunding
  reverse traffic; unsettled unlock rollback.

The pure evaluator suite also covers inclusive exact lower/upper band boundaries and one sqrt unit
outside, overshoot, decimals/currency order, timer endpoints, fee maximum/cap minimum composition,
all five sessions, callback substitution, tampered calculated caps, invalid/expired contexts, signed
int128 minimum, invalid signs, overfills, and zero references. These use synthetic references only.

TDD observations before implementation:

```text
[FAIL: missing actual-delta enforcement] testActualExactInputDeltaIsAccepted()
[FAIL: EvmError: Revert] testRegularPolicyAndActualBudgetCandidate()
[FAIL: Error != expected error: PolicyBlocked(289) != ContextMismatch()]
testSwapHookDataCannotSupplyPolicyOrReference()
```

The same tests subsequently passed. The first two exercised absent transport methods; the third
proved the production hook had no explicit hookData rejection. No tests were weakened to enable swaps.

The first full check exposed two additional reproducible regressions before these fixes:

```text
[FAIL: call reverted as expected, but without data] testConstructorRejectsReturnBombWithinBoundedGas()
[FAIL: EvmError: MemoryOOG] testRealRegistriesOraclelessSessionOnlyToken0CanSeed()
```

Tracing showed evaluator construction preceding the dependency probe, and the test-only miner
exhausting memory in its long salt search after the template hash changed. Both tests passed after
validation was reordered and fixed preimage buffers replaced loop allocations; no assertions or
production limits were loosened.

## Verification

Installed Forge path (PowerShell, from the BELL checkout):

```powershell
$forge = 'node_modules/.pnpm/@foundry-rs+forge-win32-amd64@1.7.1/node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe'
& $forge test --root contracts --match-path 'test/integration/swaps/*.sol' -vv
& $forge build --root contracts --sizes
```

Focused result:

```text
Ran 2 test suites: 23 tests passed, 0 failed, 0 skipped (23 total tests)
```

Default pinned size build passed, exit 0; Forge emits existing/test lint warnings. Current sizes
supersede the pre-M05-05 numbers in `factory-atomic-results.md`:

| Artifact | Runtime bytes | Initcode bytes | Runtime margin |
| --- | ---: | ---: | ---: |
| BellHook | 24,452 | 44,077 | 124 |
| BellModeEvaluator | 14,115 | 14,143 | 10,461 |
| BellHookDeployer | 2,996 | 48,325 | 21,580 |
| BellPoolFactory | 15,234 | 18,569 | 9,342 |

Deployer initcode margin is only 827 bytes **before constructor arguments**; its current fixed ABI
arguments consume another 96 bytes. Further evaluator growth must account for EIP-3860 as well as
EIP-170 and immutable creation-code chunks. No size limit, optimizer setting or guard was loosened.

Full `pnpm check`: first run reached Foundry with **250 passed, 2 failed** as recorded above.
The fresh run after the fixes passed 237 Node tests, 45 engineering + 18 infrastructure reference
tests, policy constants, Solidity compilation (148 source files), all 252 Foundry tests, ABI (11
interfaces), domain/protocol checks, the portable Node check + 13 Deno tests, 6 worker tests, and the
worker dry-run build. It then **failed**, exit 1, at `evidence:check`:

```text
Ran 20 test suites: 252 tests passed, 0 failed, 0 skipped (252 total tests)
Generated ABI manifest is current (11 interfaces).
Error: Brief SHA-256 does not match the release baseline
    at main (.../scripts/evidence/check-release.mjs:126:3)
ELIFECYCLE Command failed with exit code 1.
```

At that time the failing identity was the `docs/` mirror, not the authoritative root brief. The owner's
snapshot-acceptance decision was promoted from the mirror into the root brief/plan, mirrors were
resynchronized, and the hashes below were rebaselined:

| File | SHA-256 |
| --- | --- |
| Root and mirrored brief (baseline) | `2e7dbe11c4c01cd6d32415c8246a8a29878c92ee0c3500b7f888e7ba4e11fa0c` |
| Root and mirrored plan (baseline) | `60ba23881cfd367f5205fd0872399d16e6fb449bf9713a1505a3e1ac753641a3` |

The owner's snapshot-acceptance decision has now been promoted into the root documents and baseline;
the `docs/` copies are synchronized. `pnpm check:secrets`, which that earlier failed chain did not reach,
passed separately:

```text
Secret boundary checks passed; no credentials are wired into untrusted PR jobs.
```

At that earlier checkpoint the full check was **not** reported as passing. `git diff --check` passed for the tracked files touched
by this task (Git emitted only its LF/CRLF conversion notices). No commit was made and
`apps/web/tsconfig.tsbuildinfo` was not modified by this task.

A separate invocation of `validateTaskStatus` against the authoritative root plan also found another
unrelated evidence blocker, normally masked by the earlier document-hash failure:

```text
Error: Task M07-05 cannot be DONE without evidence and no blockers
```

That M07-05 DONE-with-blocker row was later corrected to IN_PROGRESS because indexer/maintenance
schedule execution remains unevidenced. The validator was not bypassed or relaxed.

## Fresh verification after task-status correction

The earlier failure above was superseded after reconciling task-status rows marked DONE with
non-empty blockers and aligning the owner-approved RPC snapshot decision across root docs/mirrors and
the release baseline. M07-04's verified private-bucket roundtrip evidence was retained; M07-05 and tasks
awaiting external dependencies remain IN_PROGRESS. The latest full `pnpm check` passed: 243 Node unit
tests, 45 engineering and 18 infrastructure reference tests, policy constants, Solidity compilation
(149 first-party/imported sources), **309 Forge tests**, ABI (11 interfaces), domain/protocol checks,
portable Node + 15 Deno tests, 6 Worker tests, Worker dry-run, evidence structure, and secret-boundary check. E01–E06 remain
NOT_RUN; this is not deployment, audit, fork, data-rights or release approval. `forge build --root
contracts --sizes` passed independently: BellHook 24,390 B, BellModeEvaluator 4,770 B,
BellHookDeployer 2,996 B, BellPoolFactory 15,234 B. Target-chain Cancun/fork compatibility remains
unverified.

## Remaining work and blockers

Acceptance is deliberately **not** declared complete: production snapshot/callback wiring (1–2),
authenticated reference/deviation/corporate integration and coherent execution views (3–4), and real
BellHook integration coverage (6) are unfinished. The size gate (5) passes locally. The fixture-only
successes above must not be used to replace those missing production-path requirements.

1. **Internal integration unfinished:** production BellHook does not yet collect an authenticated
   execution reference/corporate snapshot, persist a pending swap, or invoke `prepare`/`settle` in its
   callbacks. It still has `SWAP_EXECUTION_READY=false`, `canSwap=false`, and no successful afterSwap.
   The evaluator API is not a user authorization API. Its inputs cannot be taken from hookData.
2. Production PolicyView/execution/stateHash must share the same reference/provenance, corporate/BELL
   timers, effective caps, rolled remaining budgets and closure nonce. Reference profile admission and
   cross-source/deviation checks must precede pure arithmetic; this patch does not replace them.
3. Reviewed real price-band/referenceMode profiles, entitled onchain source access and a pinned
   Robinhood-compatible fork remain external dependencies. No numeric referenceMode mapping or
   substitute oracle was invented. PRICE_GUARDED factory creation remains rejected.
4. Production callback snapshot wiring must fit the extremely small hook/deployer size margins.
   The fixture's storage-heavy snapshots are not gas-target evidence. The 350k/550k hot-path budgets
   require optimized production wiring and explicit measurement, not interpretation of test gas totals.
5. The factory can atomically set the hook lifecycle to LIVE, but its mode stays HALTED and
    `canSwap=false` until the **actual BellHook** callback path passes. These synthetic-context vectors
    do not upgrade M05-05, M06, E01–E06, audit, release or production status.
