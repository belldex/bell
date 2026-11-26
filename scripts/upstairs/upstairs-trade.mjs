#!/usr/bin/env node
/**
 * Signs a block quote with the maker wallet and fills it from the taker wallet on mainnet. Dry run (a simulation) unless --broadcast.
 *
 *   node scripts/upstairs/upstairs-trade.mjs --shares 0.1 --maker-env LP_TEST_PRIVATE_KEY_2 --taker-env RH_MAINNET_DEPLOYER_PRIVATE_KEY --expect-revert UpstairsClosed --id U5 --broadcast
 *   node scripts/upstairs/upstairs-trade.mjs --shares 0.0067 --sells true --maker-env ... --taker-env ... --broadcast        # a real block
 *
 * --shares   stock tokens in the quote (decimal)            --price   USDG per share (default: the Chainlink reference now)
 * --sells    true when the maker sells the stock token       --nonce   default: a random one
 * --id U4|U5|U6|U7 with --expect-revert <ErrorName>: the fill is sent with a fixed gas limit and no simulation, so the reverted transaction lands on
 *            chain; it is recorded in evidence/upstairs/negatives.json for the proof. Without --expect-revert the exact token approvals are sent first.
 * --twice    after a real fill succeeds, send the same signed quote again (U6): the second fill must revert with NonceUsed; recorded with --id U6
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, keccak256, toHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// The four-byte selector of a parameterless custom error. (viem's toFunctionSelector on an error ABI item hashes a different string.)
const errorSelector = (name) => keccak256(toHex(`${name}()`)).slice(0, 10);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const broadcast = flag('broadcast');
const env = {};
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, ''); } } catch { /* CI */ }
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
const acct = (n) => { if (!env[n]) throw new Error(`${n} is not set`); return privateKeyToAccount(env[n].startsWith('0x') ? env[n] : `0x${env[n]}`); };
const deploy = JSON.parse(readFileSync('evidence/deploy/upstairs-4663.json', 'utf8'));
const artifact = JSON.parse(readFileSync('contracts/out/UpstairsSettlement.sol/UpstairsSettlement.json', 'utf8'));
const rpc = env.RH_MAINNET_RPC_SECONDARY || env.RH_MAINNET_RPC_PRIMARY;
const pc = createPublicClient({ transport: http(rpc) });
const maker = acct(arg('maker-env', 'LP_TEST_PRIVATE_KEY_2'));
const taker = acct(arg('taker-env', 'RH_MAINNET_DEPLOYER_PRIVATE_KEY'));
const makerWc = createWalletClient({ account: maker, transport: http(rpc) });
const takerWc = createWalletClient({ account: taker, transport: http(rpc) });
const settlement = getAddress(deploy.contract);
const stockToken = getAddress(deploy.constructor.stockTokens[0]);
const quoteToken = getAddress(deploy.constructor.quoteToken);
const feed = deploy.constructor.feeds[0];
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)']);

const round = await pc.readContract({ address: feed, abi: parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']), functionName: 'latestRoundData' });
const refPrice = Number(round[1]) / 1e8;
const feedAge = Math.floor(Date.now() / 1000) - Number(round[3]);
const shares = parseUnits(arg('shares', '0.1'), 18);
const price = parseUnits(arg('price', refPrice.toFixed(6)), 18);
const makerSells = arg('sells', 'true') === 'true';
const nonce = BigInt(arg('nonce', String(Math.floor(Math.random() * 1e12))));
const now = Math.floor(Date.now() / 1000);
const quote = { maker: maker.address, taker: taker.address, stockToken, quoteToken, makerSells, stockAmount: shares, price, expiry: BigInt(now + 100), nonce };
const signature = await maker.signTypedData({
  domain: { name: 'BELL Upstairs', version: '1', chainId: 4663, verifyingContract: settlement },
  types: { BlockQuote: [
    { name: 'maker', type: 'address' }, { name: 'taker', type: 'address' }, { name: 'stockToken', type: 'address' }, { name: 'quoteToken', type: 'address' },
    { name: 'makerSells', type: 'bool' }, { name: 'stockAmount', type: 'uint256' }, { name: 'price', type: 'uint256' }, { name: 'expiry', type: 'uint64' }, { name: 'nonce', type: 'uint256' },
  ] },
  primaryType: 'BlockQuote', message: quote,
});
const notional = (shares * price) / 10n ** 30n;
console.log(JSON.stringify({ mode: broadcast ? 'BROADCAST' : 'DRY', settlement, maker: maker.address, taker: taker.address, makerSells, shares: arg('shares', '0.1'), priceUsdg: Number(price) / 1e18, referenceUsdg: refPrice, feedAgeSeconds: feedAge, notionalUsdg: Number(notional) / 1e6, nonce: String(nonce) }, null, 2));

const expect = arg('expect-revert', null);
const send = async (fixedGas) => {
  const data = (await import('viem')).encodeFunctionData({ abi: artifact.abi, functionName: 'fill', args: [quote, signature] });
  const hash = await takerWc.sendTransaction({ to: settlement, data, gas: fixedGas });
  return { hash, receipt: await pc.waitForTransactionReceipt({ hash }) };
};
const record = (id, hash) => {
  const file = 'evidence/upstairs/negatives.json';
  const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  if (!all.some((x) => x.id === id)) all.push({ id, tx: hash });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
};

if (!broadcast) {
  try { await pc.simulateContract({ address: settlement, abi: artifact.abi, functionName: 'fill', args: [quote, signature], account: taker }); console.log('simulation: the fill would succeed'); }
  catch (e) { console.log(`simulation: reverts with ${e.cause?.data?.errorName ?? e.cause?.cause?.data?.errorName ?? e.shortMessage}`); }
  process.exit(0);
}

if (expect) {
  const want = errorSelector(expect);
  const first = await send(600_000n);
  console.log(`fill ${first.receipt.status}: ${first.hash}`);
  if (first.receipt.status !== 'reverted') throw new Error(`the fill did not revert (it should have reverted with ${expect})`);
  let data = null;
  try { await pc.call({ to: settlement, data: (await pc.getTransaction({ hash: first.hash })).input, account: taker.address, blockNumber: first.receipt.blockNumber - 1n }); }
  catch (e) { let c = e; while (c && !data) { data = typeof c.data === 'string' && c.data.startsWith('0x') ? c.data : null; c = c.cause; } }
  console.log(`replayed one block earlier: ${data ? data.slice(0, 10) : 'no revert data'}, expected ${want} (${expect})`);
  if (!data?.startsWith(want)) throw new Error('the revert is not the expected error: not recorded');
  if (arg('id')) record(arg('id'), first.hash);
  process.exit(0);
}

// A real fill. Exact approvals first.
const need = makerSells
  ? [[maker, makerWc, stockToken, shares], [taker, takerWc, quoteToken, notional + (notional * 5n) / 10000n + 10n]]
  : [[taker, takerWc, stockToken, shares], [maker, makerWc, quoteToken, notional + 10n]];
for (const [a, w, token, amount] of need) {
  const have = await pc.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [a.address, settlement] });
  if (have < amount) { const h = await w.writeContract({ address: token, abi: erc20, functionName: 'approve', args: [settlement, amount] }); await pc.waitForTransactionReceipt({ hash: h }); console.log(`approved ${amount} for ${a.address}`); }
}
const sim = await pc.simulateContract({ address: settlement, abi: artifact.abi, functionName: 'fill', args: [quote, signature], account: taker });
const hash = await takerWc.writeContract({ ...sim.request, gas: 700_000n });
const receipt = await pc.waitForTransactionReceipt({ hash });
console.log(`fill ${receipt.status}: ${hash}`);
if (flag('twice') && receipt.status === 'success') {
  const second = await send(600_000n);
  console.log(`second fill of the same quote ${second.receipt.status}: ${second.hash}`);
  if (second.receipt.status === 'reverted' && arg('id')) record(arg('id'), second.hash);
}
