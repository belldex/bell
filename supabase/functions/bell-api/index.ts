// BELL public API edge function (M08-01..05 live deployment).
// Thin Deno wrapper over the tested pure-logic contract modules; reads use
// the sanitized public views + observed-block provenance from authenticated
// Alchemy RPC. Big numbers stay decimal strings; no secrets reach responses.
import { route, normalizePathPrefix, envelope, errorBody, validateChainId, validateBoundedLimit, validateHash, ValidationError } from "../../../packages/protocol/src/api-schema.mjs";
import { readAssets, readPolicy, readTransaction } from "../../../packages/protocol/src/api-reads.mjs";
import { validateQuoteRequest, quoteResponse, isPolicyBlock } from "../../../packages/protocol/src/api-quote.mjs";
import { validateCreateRequest, createPreview } from "../../../packages/protocol/src/api-create.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RPC_PRIMARY = Deno.env.get("RH_MAINNET_RPC_PRIMARY");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

async function observedBlock(chainId: number) {
  if (!RPC_PRIMARY) return { rpcAvailable: false, observedBlockNumber: null, observedBlockHash: null, observedAt: null };
  const head = await fetch(RPC_PRIMARY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = await head.json();
  if (!payload?.result?.hash) throw new Error("RPC_HEAD_MALFORMED");
  return {
    rpcAvailable: true,
    observedBlockNumber: parseInt(payload.result.number, 16),
    observedBlockHash: payload.result.hash,
    observedAt: Date.now(),
  };
}

async function rest(table: string, search = "") {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + table + search, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("REST_" + response.status);
  return response.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const requestId = crypto.randomUUID().slice(0, 8);
  const headers = { ...CORS, "content-type": "application/json" };

  // M08-05: bounded per-IP admission, 120 req/menit, atomic via bump_api_quota.
  // estimated_usage = admitted requests; Prinsip QuotaMeter (domain/quota.mjs).
  const ip = req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "0.0.0.0").split(",")[0].trim();
  const minute = new Date().toISOString().slice(0, 16);
  const admission = await fetch(SUPABASE_URL + "/rest/v1/rpc/bump_api_quota", {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE, "content-type": "application/json" },
    body: JSON.stringify({ p_scope: ip, p_resource: "api-read", p_period: minute, p_limit: 120 }),
    signal: AbortSignal.timeout(4000),
  });
  if (!admission.ok) throw new Error("QUOTA_" + admission.status);
  const quota = await admission.json();
  if (!quota.admitted) {
    return new Response(JSON.stringify(errorBody("RATE_LIMITED", { message: "rate limit exceeded: 120 requests per minute per IP", retryAfterSeconds: 60, requestId })), { status: 429, headers });
  }
  try {
    const match = route(req.method, normalizePathPrefix(url.pathname));
    if (!match) {
      return new Response(JSON.stringify(errorBody("NOT_FOUND", { message: "no route " + req.method + " " + url.pathname, requestId })), { status: 404, headers });
    }
    const chainId = validateChainId(url.searchParams.get("chain") ?? "4663");
    const provenance = await observedBlock(chainId);
    if (!provenance.rpcAvailable) {
      return new Response(JSON.stringify(errorBody("UNAVAILABLE", { message: "authenticated RPC primary not configured", retryAfterSeconds: 60, requestId })), { status: 503, headers });
    }

    switch (match.endpoint.path) {
      case "/assets": {
        const limit = validateBoundedLimit(url.searchParams.get("limit") ?? "50", { max: 100 });
        const rows = await rest("public_assets", "?limit=" + limit);
        return new Response(JSON.stringify(readAssets({
          chainId, assets: rows, cursor: url.searchParams.get("cursor") ?? undefined, limit,
          observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, observedAt: provenance.observedAt, requestId,
        })), { headers });
      }
      case "/pools": {
        const limit = validateBoundedLimit(url.searchParams.get("limit") ?? "50", { max: 100 });
        const rows = await rest("public_pools", "?limit=" + limit);
        return new Response(JSON.stringify(envelope({
          chainId, observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, observedAt: provenance.observedAt, requestId,
          extra: { pools: rows, nextCursor: null },
        })), { headers });
      }
      case "/pools/{id}/policy": {
        const poolId = match.params.id;
        const rows = await rest("public_pools", "?pool_id=eq." + poolId + "&limit=1");
        if (rows.length === 0) {
          return new Response(JSON.stringify(errorBody("NOT_FOUND", { message: "pool not found", requestId })), { status: 404, headers });
        }
        return new Response(JSON.stringify(readPolicy({
          chainId, poolId,
          onchainPolicy: { configHash: null, class: rows[0].class, lifecycle: "REGISTERED", referenceMode: rows[0].reference_mode, effectiveLpFee: null, reasons: ["M06_POOL_CONTRACTS_NOT_DEPLOYED"], budgets: {}, canSwap: false },
          observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, observedAt: provenance.observedAt, requestId,
        })), { headers });
      }
      case "/quote": {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") throw new ValidationError("body", "must be a JSON object");
        const merged = Object.assign({}, body, { configHash: "0x" + "0".repeat(64), quoteExpirySeconds: 30, deadlineSeconds: 120 });
        const request = validateQuoteRequest(merged);
        // Execution simulation requires the M05/M06 contracts; return a typed response, not a misleading 503.
        const response = quoteResponse({
          chainId, observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, observedAt: provenance.observedAt, requestId,
          request, quoteExpirySeconds: 30,
          simulation: { canExecute: false, reasons: ["M05_M06_CONTRACTS_NOT_DEPLOYED"], revertReason: null },
        });
        return new Response(JSON.stringify(response), { status: 200, headers });
      }
      case "/create-preview": {
        const body = await req.json().catch(() => null);
        const request = validateCreateRequest(body ?? {});
        const registry = {
          hasDescriptor: () => false,
          capabilities: () => ({ canonicalStock: false, independentPriceSource: false }),
          predictedHook: () => null, predictedPoolId: () => null, requestHashFor: () => null, configHashFor: () => null,
        };
        const response = createPreview({ chainId, request, registry, observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, observedAt: provenance.observedAt, requestId });
        return new Response(JSON.stringify(response), { headers });
      }
      case "/tx/{hash}": {
        const txHash = validateHash(match.params.hash, "txHash");
        const rows = await rest("transactions", "?tx_hash=eq." + txHash + "&limit=1");
        return new Response(JSON.stringify(readTransaction({
          chainId, txHash,
          indexed: rows.length ? { state: rows[0].finality_state, observedBlockNumber: provenance.observedBlockNumber, observedBlockHash: provenance.observedBlockHash, reorgState: rows[0].reorg_state } : null,
          observedAt: provenance.observedAt, requestId,
        })), { status: rows.length ? 200 : 404, headers });
      }
      default:
        return new Response(JSON.stringify(errorBody("NOT_FOUND", { requestId })), { status: 404, headers });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(JSON.stringify(errorBody("VALIDATION", { field: error.field, message: error.message, requestId })), { status: 400, headers });
    }
    return new Response(JSON.stringify(errorBody("INTERNAL", { message: "internal error", requestId })), { status: 500, headers });
  }
});
