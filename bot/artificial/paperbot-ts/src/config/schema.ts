import { z } from "zod";

const positiveFinite = z.number().finite().positive();
const nonNegativeFinite = z.number().finite().nonnegative();

export const liveRiskSchema = z
  .object({
    maxTradeSol: positiveFinite,
    maxExposureSol: positiveFinite,
    maxOpenPositions: z.number().int().min(1).max(20),
    maxSlippageBps: z.number().int().min(1).max(5_000),
    maxPriorityFeeLamports: nonNegativeFinite,
    maxTipLamports: nonNegativeFinite,
    maxDailyLossSol: positiveFinite,
  })
  .superRefine((risk, context) => {
    if (risk.maxTradeSol > risk.maxExposureSol) {
      context.addIssue({
        code: "custom",
        path: ["maxTradeSol"],
        message: "maxTradeSol cannot exceed maxExposureSol",
      });
    }
  });

export const configSchema = z.object({
  trading_enabled: z.boolean().default(true),
  simulation_mode: z.boolean().default(true),
  initial_balance_sol: positiveFinite.default(0.5),
  initial_balance_eth: positiveFinite.default(0.021),
  compounding_enabled: z.boolean().default(true),
  position_pct_of_balance: z.number().finite().min(0.1).max(35).default(25),
  safety_net_floor_sol: nonNegativeFinite.default(0.08),
  safety_net_floor_eth: nonNegativeFinite.default(0.003),
  min_whale_buy_sol: nonNegativeFinite.default(0.2),
  min_whale_buy_eth: nonNegativeFinite.default(0.005),
  velocity_watchdog_seconds: z.number().int().min(1).max(86_400).default(45),
  velocity_exit_drop_pct: z.number().finite().min(0.1).max(100).default(8),
  max_open_positions: z.number().int().min(1).max(20).default(3),
  max_entry_mcap_sol: positiveFinite.default(65),
  take_profit_pct: z.number().finite().min(1).max(100_000).default(120),
  stop_loss_pct: z.number().finite().min(0.1).max(100).default(25),
  trailing_stop_enabled: z.boolean().default(true),
  trailing_stop_activation_pct: z.number().finite().min(0).max(100_000).default(40),
  trailing_stop_callback_pct: z.number().finite().min(0.1).max(100).default(20),
  confluence_required: z.boolean().default(false),
  confluence_window_seconds: z.number().int().min(1).max(86_400).default(120),
  min_liquidity_sol: nonNegativeFinite.default(25),
  max_holding_time_minutes: z.number().int().min(1).max(43_200).default(60),
  strict_rugcheck: z.boolean().default(false),
  liveRisk: liveRiskSchema.optional(),
});

export type LegacyConfig = z.infer<typeof configSchema>;
export type LiveRiskPolicy = z.infer<typeof liveRiskSchema>;
