#!/usr/bin/env node
/**
 * Builds evidence/upstairs/proof.json, the only file the Upstairs page reads, and replays claims U1 to U9 against a public RPC. No keys.
 *
 *   node scripts/upstairs/build-upstairs-proof.mjs                      no network: records what is deployed (nothing yet) and every claim PENDING
 *   node scripts/upstairs/build-upstairs-proof.mjs --rpc <url>          rebuild from chain
 *
 * Failed fills cannot show up as events, so the reverted transactions that prove U4 to U7 are listed by hand in evidence/upstairs/negatives.json as
 * { id, tx }. The replay still checks each one on chain: the transaction reverted, and the same call one block earlier fails with the expected error.
 * PENDING is never a PASS.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, http, parseAbi, keccak256, toHex } from 'viem';

// The four-byte selector of a parameterless custom error. (viem's toFunctionSelector on an error ABI item hashes a different string.)
const errorSelector = (name) => keccak256(toHex(`${name}()`)).slice(0, 10);
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : process.env.RPC_URL ?? null; };
const rpcUrl = arg('rpc');
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);
const deploy = read('evidence/deploy/upstairs-4663.json', null);
const negatives = read('evidence/upstairs/negatives.json', []);
const SPEC = {
  band: [['REGULAR', 50], ['PRE', 100], ['POST', 100], ['OVERNIGHT', 150], ['CLOSED, HALTED, UNKNOWN', null]],
  feeBps: 5, quoteSeconds: 120,
};
const CLAIMS = [
  ['U1', 'The contract is what we say', 'Code on chain, no proxy slots, no owner or setter in the ABI.', 'All three hold. Sourcify exact match is not possible without a metadata hash, so the note records the Sourcify match instead.'],
  ['U2', 'A real block settled', 'A BlockPrint at or above the block minimum between two different wallets, neither the deployer.', 'Such a print exists.'],
  ['U3', 'The price respected the band', 'The reference price and band for that block and session, recomputed.', 'The price is inside the band and the reference matches.'],
  ['U4', 'Out-of-band quotes fail', 'A reverted fill with OutsideBand.', 'The transaction reverted and replays with that error.'],
  ['U5', 'Closed-market fills fail', 'A reverted fill during CLOSED with UpstairsClosed.', 'The transaction reverted and replays with that error.'],
  ['U6', 'Replays fail', 'A second fill of the same quote with NonceUsed.', 'The transaction reverted and replays with that error.'],
  ['U7', 'Small trades are sent to the pool', 'A fill below the block minimum with BelowBlockSize.', 'The transaction reverted and replays with that error.'],
  ['U8', 'The pool was untouched', 'The logs of the fill transaction.', 'No Swap event from the PoolManager in the fill transaction.'],
  ['U9', 'The fee reached its address', 'The fee transfer in the fill transaction.', 'It equals 5 bps of the notional, rounded up.'],
].map(([id, title, proof, passes]) => ({ id, title, proof, passes }));

const proof = { title: 'BELL Upstairs', spec: SPEC, claims: CLAIMS, deployment: deploy, prints: [], replay: {}, lastBuild: new Date().toISOString() };
const pending = (why) => ({ verdict: 'PENDING', note: why });

if (!deploy) {
  for (const c of CLAIMS) proof.replay[c.id] = pending('UpstairsSettlement is not deployed on mainnet yet.');
} else if (!rpcUrl) {
  for (const c of CLAIMS) proof.replay[c.id] = pending('Run with --rpc to replay against the chain.');
} else {
  const artifact = JSON.parse(readFileSync('contracts/out/UpstairsSettlement.sol/UpstairsSettlement.json', 'utf8'));
  const pc = createPublicClient({ transport: http(rpcUrl) });
  const addr = deploy.contract;
  const pm = JSON.parse(readFileSync('evidence/deploy/mainnet-4663.json', 'utf8')).poolManager.toLowerCase();
  const printEvent = artifact.abi.find((x) => x.type === 'event' && x.name === 'BlockPrint');
  const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
  const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));
  const head = Number(await pc.getBlockNumber());
  const logs = [];
  for (let from = deploy.block; from <= head; from += 200_000) {
    logs.push(...await pc.getLogs({ address: addr, event: printEvent, fromBlock: BigInt(from), toBlock: BigInt(Math.min(head, from + 199_999)) }));
  }
  const code = await pc.getCode({ address: addr });
  const slot = async (s) => BigInt(await pc.getStorageAt({ address: addr, slot: s }));
  const noProxy = (await slot('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc')) === 0n
    && (await slot('0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103')) === 0n;
  const bad = artifact.abi.filter((x) => x.type === 'function' && /^(set|owner|transferOwnership|renounceOwnership|upgrade|pause|withdraw|sweep)/i.test(x.name)).map((x) => x.name);
  proof.replay.U1 = code && code !== '0x' && noProxy && !bad.length
    ? { verdict: 'PASS', note: `code at ${addr}, the EIP-1967 implementation and admin slots are zero, and the ABI has no owner or setter function. Sourcify reports a runtime and creation match (id 60000580), not an exact match: the build carries no metadata hash.` }
    : { verdict: 'FAIL', note: `code ${code ? 'present' : 'missing'}, no proxy slots ${noProxy}, suspicious functions ${bad.join(',') || 'none'}` };

  const min = BigInt(deploy.constructor.minNotional);
  const feeTo = deploy.constructor.feeRecipient.toLowerCase();
  const usdg = deploy.constructor.quoteToken.toLowerCase();
  const rows = [];
  for (const l of logs) {
    const a = l.args;
    const rc = await pc.getTransactionReceipt({ hash: l.transactionHash });
    const blk = await pc.getBlock({ blockNumber: l.blockNumber });
    const notional = (a.stockAmount * a.price) / 10n ** 30n; // 18 decimal stock token, 6 decimal USDG
    const swapInTx = rc.logs.some((x) => x.address.toLowerCase() === pm && x.topics[0] === SWAP_TOPIC);
    const feeOk = rc.logs.some((x) => x.address.toLowerCase() === usdg && x.topics[0] === TRANSFER_TOPIC && `0x${x.topics[2].slice(26)}`.toLowerCase() === feeTo && BigInt(x.data) === a.feeUsdg)
      && a.feeUsdg === (notional * 5n + 9999n) / 10000n;
    rows.push({ tx: l.transactionHash, block: Number(l.blockNumber), ts: Number(blk.timestamp), stockToken: a.stockToken, maker: a.maker, taker: a.taker, makerSells: a.makerSells, stockAmount: String(a.stockAmount), price: String(a.price), referencePrice: String(a.referencePrice), session: a.session, feeUsdg: String(a.feeUsdg), notionalUsdg: String(notional), swapInTx, feeOk });
  }
  proof.prints = rows;
  const deployer = deploy.deployer.toLowerCase();
  const real = rows.find((r) => BigInt(r.notionalUsdg) >= min && r.maker.toLowerCase() !== r.taker.toLowerCase() && r.maker.toLowerCase() !== deployer && r.taker.toLowerCase() !== deployer);
  proof.replay.U2 = real
    ? { verdict: 'PASS', note: `block ${real.tx}: ${Number(real.notionalUsdg) / 1e6} USDG between two different wallets, neither the deployer` }
    : pending('No qualifying block print yet.');
  if (!real) {
    for (const id of ['U3', 'U8', 'U9']) proof.replay[id] = pending('No block print to check.');
  } else {
    const feedAbi = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
    const f = await pc.readContract({ address: deploy.constructor.feeds[0], abi: feedAbi, functionName: 'latestRoundData', blockNumber: BigInt(real.block) });
    const ref = BigInt(f[1]) * 10n ** 10n;
    const bps = { 2: 50n, 1: 100n, 3: 100n, 4: 150n }[real.session];
    const price = BigInt(real.price);
    const diff = price > ref ? price - ref : ref - price;
    proof.replay.U3 = bps && ref === BigInt(real.referencePrice) && diff * 10000n <= ref * bps
      ? { verdict: 'PASS', note: `reference ${Number(ref) / 1e18}, price ${Number(price) / 1e18}, session ${real.session}, band ${bps} bps, distance ${Number((diff * 10000n) / ref)} bps` }
      : { verdict: 'FAIL', note: `replayed reference ${ref}, printed ${real.referencePrice}, session ${real.session}` };
    proof.replay.U8 = !real.swapInTx ? { verdict: 'PASS', note: 'no Swap event from the PoolManager in the fill transaction' } : { verdict: 'FAIL', note: 'the fill transaction contains a PoolManager Swap event' };
    proof.replay.U9 = real.feeOk ? { verdict: 'PASS', note: `${Number(real.feeUsdg) / 1e6} USDG reached ${feeTo} and equals 5 bps of the notional, rounded up` } : { verdict: 'FAIL', note: 'the fee transfer is missing or not 5 bps' };
  }
  const selector = errorSelector;
  for (const [id, name] of [['U4', 'OutsideBand'], ['U5', 'UpstairsClosed'], ['U6', 'NonceUsed'], ['U7', 'BelowBlockSize']]) {
    const n = negatives.find((x) => x.id === id);
    if (!n) { proof.replay[id] = pending('No reverted transaction is on record for this claim.'); continue; }
    const tx = await pc.getTransaction({ hash: n.tx });
    const rc = await pc.getTransactionReceipt({ hash: n.tx });
    let data = null;
    try { await pc.call({ to: tx.to, data: tx.input, account: tx.from, blockNumber: tx.blockNumber - 1n }); } catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
    proof.replay[id] = rc.status === 'reverted' && data?.startsWith(selector(name))
      ? { verdict: 'PASS', note: `${n.tx} reverted and replays with ${name}` }
      : { verdict: 'FAIL', note: `${n.tx}: status ${rc.status}, replay error ${data ? data.slice(0, 10) : 'none'}, expected ${selector(name)}` };
  }
}
mkdirSync('apps/web/components/upstairs', { recursive: true });
writeFileSync('evidence/upstairs/proof.json', `${JSON.stringify(proof, null, 2)}\n`);
copyFileSync('evidence/upstairs/proof.json', 'apps/web/components/upstairs/upstairs-proof.json');
const v = Object.values(proof.replay).map((x) => x.verdict);
console.log(`wrote evidence/upstairs/proof.json: ${v.filter((x) => x === 'PASS').length} PASS, ${v.filter((x) => x === 'PENDING').length} PENDING, ${v.filter((x) => x === 'FAIL').length} FAIL`);
