# Reproducible Security Test Commands

Run from the repository root after installing the frozen workspace dependencies and Foundry toolchain:

```bash
# Standard project checks
pnpm check

# Full Solidity suite
pnpm exec forge test --root contracts -vv

# Loss-of-funds scenario index
pnpm exec forge test --root contracts --match-path test/integration/factory/LossOfFundsIndex.t.sol -vv

# Hook permissions and LP exit behavior
pnpm exec forge test --root contracts --match-path test/unit/hook/BellHook.t.sol -vv
pnpm exec forge test --root contracts --match-path test/integration/public-lp/PublicPositionManager.t.sol -vv

# Stateful exit invariant suite
pnpm exec forge test --root contracts --match-path test/invariant/exit/ExitLivenessFuzz.t.sol -vv

# Auction lifecycle, registry authorization, and refund properties
pnpm exec forge test --root contracts --match-path test/BellOpeningAuction.t.sol -vv
pnpm exec forge test --root contracts --match-path test/BellAuctionRegistry.t.sol -vv
pnpm exec forge test --root contracts --match-path test/BellAuctionFactoryModule.t.sol -vv

# Lens exact-input parity suite
pnpm exec forge test --root contracts --match-path test/integration/verification/BellSwapLens.t.sol -vvv

# Public chain verifier and Worker integration tests
node --test scripts/verify-bell.test.mjs
pnpm --filter @bell/keeper-b test
pnpm --filter @bell/web typecheck
pnpm --filter @bell/web build
```

The auditor should rerun all commands against the exact tagged commit, inspect compiler warnings, and separately verify the deployed bytecode, constructor bindings, roles, permissions, and representative Mainnet receipts. The public command `pnpm verify:bell` is a read-only Mainnet check; it is evidence collection, not a substitute for the security test suite.
