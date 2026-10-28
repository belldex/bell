import { readFileSync, writeFileSync } from 'node:fs';

// Sync packages/protocol/src/testnet-status.mjs from the deploy manifest. The two files have drifted
// before (the status module kept a superseded deployment), which broke every script that reads it.
const manifest = JSON.parse(readFileSync('evidence/deploy/testnet-46630.json', 'utf8'));
const path = 'packages/protocol/src/testnet-status.mjs';
let s = readFileSync(path, 'utf8');

const keys = ['safetyController', 'assetRegistry', 'calendarRegistry', 'sessionRegistry', 'poolManager',
  'positionManager', 'hookDeployer', 'poolFactory', 'weth', 'router', 'feeToken', 'permit2'];

for (const key of keys) {
  if (!manifest[key]) { console.log(`manifest has no ${key}`); continue; }
  const re = new RegExp(`(${key}:\\s*')(0x[0-9a-fA-F]{40})(')`, 'i');
  const match = s.match(re);
  if (!match) { console.log(`no field in status module: ${key}`); continue; }
  if (match[2].toLowerCase() !== manifest[key].toLowerCase()) {
    s = s.replace(re, `$1${manifest[key].toLowerCase()}$3`);
    console.log(`updated ${key}: ${match[2]} -> ${manifest[key]}`);
  } else {
    console.log(`ok ${key}`);
  }
}

writeFileSync(path, s);
console.log('\nstatus module synced from manifest');
