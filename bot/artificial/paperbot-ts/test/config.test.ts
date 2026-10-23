import assert from "node:assert/strict";
import test from "node:test";
import { assertLiveGate, loadConfig, LiveModeLockedError } from "../src/config/load.js";

const legacyConfig = {
  trading_enabled: true,
  simulation_mode: true,
  initial_balance_sol: 0.5,
  initial_balance_eth: 0.021,
  compounding_enabled: true,
  position_pct_of_balance: 25,
  safety_net_floor_sol: 0.08,
  safety_net_floor_eth: 0.003,
  max_open_positions: 3,
  take_profit_pct: 120,
  stop_loss_pct: 25,
  trailing_stop_enabled: true,
  trailing_stop_activation_pct: 40,
  trailing_stop_callback_pct: 20,
};

test("legacy config defaults to paper mode with simulated execution", () => {
  const config = loadConfig(legacyConfig, {});
  assert.equal(config.mode, "paper");
  assert.equal(config.simulationMode, true);
});

test("invalid position limits are rejected instead of becoming NaN state", () => {
  assert.throws(
    () => loadConfig({ ...legacyConfig, max_open_positions: -3 }, {}),
    /max_open_positions/i,
  );
});

test("live mode cannot be selected without the explicit live acknowledgement", () => {
  const config = loadConfig(legacyConfig, { TRADING_MODE: "live" });
  assert.equal(config.mode, "live");
  assert.throws(
    () => assertLiveGate(config, { signerConfigured: true }),
    LiveModeLockedError,
  );
});

test("live mode rejects missing risk limits even when acknowledged", () => {
  const config = loadConfig(legacyConfig, {
    TRADING_MODE: "live",
    ALLOW_LIVE_TRADING: "true",
  });
  assert.throws(
    () => assertLiveGate(config, { signerConfigured: true }),
    /risk/i,
  );
});

test("live mode rejects a missing signer even with the full explicit gate", () => {
  const config = loadConfig(
    {
      ...legacyConfig,
      liveRisk: {
        maxTradeSol: 0.05,
        maxExposureSol: 0.2,
        maxOpenPositions: 2,
        maxSlippageBps: 300,
        maxPriorityFeeLamports: 100_000,
        maxTipLamports: 100_000,
        maxDailyLossSol: 0.1,
      },
    },
    { TRADING_MODE: "live", ALLOW_LIVE_TRADING: "true" },
  );
  assert.throws(
    () => assertLiveGate(config, { signerConfigured: false }),
    /signer/i,
  );
});

test("paper mode never requires or constructs a signer", () => {
  const config = loadConfig(legacyConfig, {});
  assert.doesNotThrow(() => assertLiveGate(config, { signerConfigured: false }));
});
