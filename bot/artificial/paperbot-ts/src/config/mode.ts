export type RuntimeMode = "paper" | "live";

export class RuntimeModeError extends Error {
  constructor(value: string) {
    super(`Unsupported TRADING_MODE: ${value}`);
    this.name = "RuntimeModeError";
  }
}

export function resolveRuntimeMode(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeMode {
  const mode = env["TRADING_MODE"] ?? "paper";
  if (mode !== "paper" && mode !== "live") {
    throw new RuntimeModeError(mode);
  }
  return mode;
}
