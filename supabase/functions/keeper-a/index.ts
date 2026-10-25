// Keeper A edge function (M09-01 live): authenticated cron caller, fenced
// lease via public.acquire_job_lease, 20s application deadline, no-op tick
// without oracle entitlement never signs or broadcasts anything.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

async function rpc(fn: string, args: Record<string, unknown>) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE, "content-type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 400 || response.status === 403) {
    const detail = await response.text();
    return { held: true, detail: detail.slice(0, 120) };
  }
  if (!response.ok) throw new Error("RPC_" + response.status);
  const text = await response.text();
  return { held: false, result: text ? JSON.parse(text) : null };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const startedAt = Date.now();
  // 1. authenticate the cron caller (brief: invocation auth, bukan origin string)
  const provided = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !provided || provided !== CRON_SECRET) {
    return new Response(JSON.stringify({ status: "UNAUTHORIZED" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const ownerToken = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
  const headers = { "content-type": "application/json" };
  try {
    // 2. fenced lease 25 detik
    const lease = await rpc("acquire_job_lease", {
      p_chain_id: 4663,
      p_job_kind: "keeper-a-tick",
      p_owner_token: "\\x" + ownerToken,
      p_ttl_seconds: 25,
    });
    if (lease.held) {
      return new Response(JSON.stringify({ status: "LEASE_HELD", detail: lease.detail ?? null, checkedAt: new Date().toISOString() }), { headers });
    }
    const fence = lease.result?.[0]?.fence ?? null;
    // 3. due work: laporan oracle butuh entitlement (M01) - belum ada, no-op jujur.
    //    No-op TIDAK menandai apa pun fresh dan TIDAK menyiapkan transaksi.
    const dueWork: Array<unknown> = [];
    // 4. release lease segera (tick tanpa pekerjaan tidak boleh memegang kunci)
    await rpc("release_job_lease", {
      p_chain_id: 4663,
      p_job_kind: "keeper-a-tick",
      p_owner_token: "\\x" + ownerToken,
      p_fence: fence,
    });
    return new Response(JSON.stringify({
      status: "NO_OP",
      fence: String(fence),
      dueWork: dueWork.length,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ status: "ERROR", message: String(error).slice(0, 160) }), { status: 500, headers });
  }
});