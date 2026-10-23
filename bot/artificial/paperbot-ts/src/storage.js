import fs from 'fs/promises';
import path from 'path';

// Sequential write queue per file path to guarantee no concurrent write races
const fileWriteLocks = new Map();

/**
 * Atomically writes data to a file by writing to a temporary file first
 * and then renaming it. Uses an in-memory lock per file to prevent race conditions.
 */
export async function atomicWriteJson(filePath, data) {
  const previousLock = fileWriteLocks.get(filePath) || Promise.resolve();

  const writeOperation = async () => {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const content = JSON.stringify(data, null, 2);

    try {
      await fs.writeFile(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      try { await fs.unlink(tmpPath); } catch {}
      throw err;
    }
  };

  const newLock = previousLock.then(writeOperation, writeOperation);
  fileWriteLocks.set(filePath, newLock);
  return newLock;
}

/**
 * Safely reads and parses a JSON file.
 * If file does not exist, returns fallback.
 * If file exists but is corrupted (JSON syntax error), it DOES NOT silently reset.
 * Instead, it creates a quarantine backup and returns { __corrupted: true, quarantinePath }
 * so caller can enter SAFE MODE instead of wiping user state.
 */
export async function safeReadJson(filePath, fallback = null) {
  let raw = null;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }

  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    // Quarantining corrupted file to protect funds and audit history
    const dir = path.dirname(filePath);
    const quarantinePath = path.join(dir, `${path.basename(filePath)}.corrupt.${Date.now()}`);
    try {
      await fs.writeFile(quarantinePath, raw, { encoding: 'utf8', mode: 0o600 });
    } catch {}

    console.error(`[Storage] 🚨 CRITICAL: File ${filePath} corrupted! Quarantined to ${quarantinePath}`);
    return { __corrupted: true, quarantinePath, parseError: parseErr.message };
  }
}
