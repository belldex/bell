import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeMode } from "../src/config/mode.js";

test("runtime defaults to paper when no mode is configured", () => {
  assert.equal(resolveRuntimeMode({}), "paper");
});

test("runtime rejects unknown modes rather than enabling live", () => {
  assert.throws(() => resolveRuntimeMode({ TRADING_MODE: "production" }));
});
