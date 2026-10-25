import { fileURLToPath } from 'node:url';

const scaffoldCommands = new Set([
  'test:invariants', 'test:e2e',
  'preflight:rpc', 'preflight:sources', 'test:fork', 'release:dry-run',
]);

export function blockedCommandMessage(command, missing) {
  if (!scaffoldCommands.has(command)) throw new Error(`Not an allowed scaffold command: ${command}`);
  if (typeof missing !== 'string' || missing.trim() === '') throw new TypeError('A concrete missing prerequisite is required');
  return `BLOCKED ${command}: ${missing}. No test was reported as passing and no transaction was broadcast.`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...missingParts] = process.argv.slice(2);
  console.error(blockedCommandMessage(command, missingParts.join(' ') || 'implementation or prerequisites unavailable'));
  process.exitCode = 2;
}
