const PUBLIC_ENV_ALLOWLIST = new Set([
  'NEXT_PUBLIC_CHAIN_ID',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]);

export function validateSecretBoundary({ envExample, workflow }) {
  if (typeof envExample !== 'string' || typeof workflow !== 'string') throw new TypeError('envExample and workflow must be text');
  const names = new Set();
  for (const [index, line] of envExample.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new Error(`Malformed environment example at line ${index + 1}`);
    const [, name, rawValue] = match;
    if (names.has(name)) throw new Error(`Duplicate environment variable ${name}`);
    names.add(name);
    const value = rawValue.trim();
    if (name.startsWith('NEXT_PUBLIC_')) {
      if (!PUBLIC_ENV_ALLOWLIST.has(name) || /PRIVATE|SECRET|SIGNING|SERVICE_ROLE|RPC|SOURCE|CREDENTIAL|TOKEN$/i.test(name)) {
        throw new Error(`Sensitive configuration cannot be exposed as ${name}`);
      }
    } else if (/(?:PRIVATE_KEY|SECRET|CREDENTIAL|SERVICE_ROLE|RPC|SOURCE)/i.test(name)) {
      if (value !== '' && !/^replace-with-(?:non-)?secret-placeholder$/i.test(value)) {
        throw new Error(`Secret-bearing environment variable ${name} must be blank in examples`);
      }
    }
  }

  if (/pull_request_target/i.test(workflow)) throw new Error('Untrusted PR workflow must not use pull_request_target');
  if (/\bsecrets\s*\./i.test(workflow)) throw new Error('Untrusted PR workflow must not access repository secrets');
  if (!/permissions:\s*\r?\n\s+contents:\s*read/i.test(workflow)) throw new Error('Workflow must use least-privilege contents: read permissions');
  const actionLines = workflow.split(/\r?\n/).filter((line) => /^\s*uses:\s*/.test(line));
  for (const line of actionLines) {
    if (!/@[a-f0-9]{40}(?:\s|$)/i.test(line)) throw new Error('GitHub Actions must be pinned to full commit SHAs');
  }
  return true;
}
