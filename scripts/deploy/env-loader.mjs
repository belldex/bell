import { existsSync, readFileSync } from 'node:fs';

/** Read a selected env file while keeping inherited process values authoritative. */
export function loadEnvFile({ filePath = process.env.BELL_ENV_FILE || '.env', base = process.env, optional = true } = {}) {
  const env = { ...base };
  if (!existsSync(filePath)) {
    if (optional) return env;
    throw new Error(`environment file not found: ${filePath}`);
  }
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && !env[match[1]]) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}
