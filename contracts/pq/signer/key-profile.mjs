import path from 'node:path';

const PROFILES = Object.freeze({
  'elysium-99801': 'BELL_PQ_ENCRYPTION_KEY',
  'robinhood-4663': 'BELL_PQ_MAINNET_ENCRYPTION_KEY',
  'robinhood-46630': 'BELL_PQ_RHTESTNET_ENCRYPTION_KEY',
});

export function resolveKeyProfile(profileName, signerDirectory) {
  const encryptionEnv = PROFILES[profileName];
  if (!encryptionEnv) throw new Error(`Unsupported PQ key profile: ${profileName}`);
  return Object.freeze({
    keyDir: path.resolve(signerDirectory, '..', 'keys', profileName),
    encryptionEnv,
  });
}
