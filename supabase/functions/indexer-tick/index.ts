// Indexer head ingest edge function (M10-02/03/04/05 live).
// Tick: lease -> eth_getBlockByNumber(latest) -> canonical chain_blocks row
// (+ ORPHANED penanda reorg bila hash beda di nomor sama) -> checkpoint -> release.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RPC = Deno.env.get('RH_MAINNET_RPC_PRIMARY');
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const CHAIN_ID = 4663;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'content-type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
  });
  if (res.status === 400 || res.status === 403) return null;
  if (!res.ok) throw new Error('RPC_' + res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function rest(path: string, method: string, body?: unknown) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('REST_' + res.status + ': ' + (await res.text()).slice(0, 160));
  return res.status === 204 ? null : res.json();
}

async function fetchHead(): Promise<{ number: string; hash: string; parentHash: string; timestamp: string }> {
  const res = await fetch(RPC!, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
    signal: AbortSignal.timeout(6000),
  });
  const j = await res.json();
  const b = j?.result;
  if (!b?.hash || !b?.number) throw new Error('RPC_HEAD_MALFORMED');
  return { number: b.number, hash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const started = Date.now();
  const provided = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || !provided || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ status: 'UNAUTHORIZED' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const owner = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
  const headers = { 'content-type': 'application/json' };
  try {
    const lease = await rpc('acquire_job_lease', { p_chain_id: CHAIN_ID, p_job_kind: 'indexer-tick', p_owner_token: '\\x' + owner, p_ttl_seconds: 25 });
    if (!lease) return new Response(JSON.stringify({ status: 'LEASE_HELD', checkedAt: new Date().toISOString() }), { headers });
    const fence = lease?.[0]?.fence ?? null;
    const head = await fetchHead();
    const headNum = BigInt(head.number);
    const headTsMs = Number(BigInt(head.timestamp) * 1000n);
    const lagSeconds = Math.max(0, Math.round((Date.now() - headTsMs) / 1000));
    // Reorg check: does the canonical row at the same number have a different hash?
    const existing = await rest("chain_blocks?chain_id=eq." + CHAIN_ID + "&block_number=eq." + headNum + "&canonical=eq.true&select=block_hash", 'GET');
    const prevHash = Array.isArray(existing) && existing[0]?.block_hash ? existing[0].block_hash.replace(/^\\\\x/, '') : null;
    const newHash = head.hash.slice(2).toLowerCase();
    let reorg = false;
    if (prevHash && prevHash !== newHash) {
      reorg = true;
      await rest("chain_blocks?chain_id=eq." + CHAIN_ID + "&block_number=eq." + headNum + "&canonical=eq.true", 'PATCH', { canonical: false, finality_state: 'ORPHANED' });
    }
    await rest('chain_blocks', 'POST', [{
      chain_id: CHAIN_ID, block_hash: '\\x' + newHash, block_number: headNum.toString(),
      parent_hash: '\\x' + head.parentHash.slice(2).toLowerCase(), canonical: true, finality_state: 'UNFINALIZED',
    }]);
    await rest('indexer_checkpoints', 'POST', [{
      chain_id: CHAIN_ID, shard_id: 'head', last_block_number: headNum.toString(),
      last_block_hash: '\\x' + newHash, lag_seconds: lagSeconds, lease_generation: String(fence ?? 0),
    }]);
    await rpc('release_job_lease', { p_chain_id: CHAIN_ID, p_job_kind: 'indexer-tick', p_owner_token: '\\x' + owner, p_fence: fence });
    return new Response(JSON.stringify({
      status: 'INGESTED', blockNumber: headNum.toString(), blockHash: '0x' + newHash,
      reorg, lagSeconds, durationMs: Date.now() - started, checkedAt: new Date().toISOString(),
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ status: 'ERROR', message: String(error).slice(0, 200) }), { status: 500, headers });
  }
});
