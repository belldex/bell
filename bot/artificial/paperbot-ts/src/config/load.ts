import { configSchema, type LegacyConfig, type LiveRiskPolicy } from "./schema.js";
import { resolveRuntimeMode, type RuntimeMode } from "./mode.js";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export class LiveModeLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveModeLockedError";
  }
}

export interface BotConfig extends LegacyConfig {
  mode: RuntimeMode;
  allowLiveTrading: boolean;
  simulationMode: boolean;
}

export interface LiveGateContext {
  signerConfigured: boolean;
}

export function loadConfig(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
): BotConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new ConfigValidationError(details);
  }

  const mode = resolveRuntimeMode(env);
  return {
    ...parsed.data,
    mode,
    allowLiveTrading: env["ALLOW_LIVE_TRADING"] === "true",
    // This property describes executor selection, not the legacy JSON flag.
    simulationMode: mode === "paper",
  };
}

export function assertLiveGate(config: BotConfig, context: LiveGateContext): void {
  if (config.mode === "paper") return;

  if (!config.allowLiveTrading) {
    throw new LiveModeLockedError("Live mode requires ALLOW_LIVE_TRADING=true");
  }
  if (!config.liveRisk) {
    throw new LiveModeLockedError("Live mode requires a complete liveRisk policy");
  }
  if (!context.signerConfigured) {
    throw new LiveModeLockedError("Live mode requires an injected signer provider");
  }
}

export function isCompleteLiveRiskPolicy(
  value: unknown,
): value is LiveRiskPolicy {
  return liveRiskSafeParse(value);
}

function liveRiskSafeParse(value: unknown): value is LiveRiskPolicy {
  return configSchema.shape.liveRisk.safeParse(value).success;
}
