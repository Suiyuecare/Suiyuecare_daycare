import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchFinanceSummary } from "./finance-client";

/** Opt-in cross-repository proof. Only a loopback server and synthetic RPC are used. */
const financeRoot = process.env.FINANCE_CONTRACT_REPO;
describe.skipIf(!financeRoot)("real daycare fetch -> Finance HTTP handler contract", () => {
  it("accepts native Node fetch headers and the same exact token/payload/response", async () => {
    const require = createRequire(import.meta.url);
    const { createSummaryHandler } = require(resolve(financeRoot!, "supabase/functions/daycare-store-finance-summary/core.mjs")) as {
      createSummaryHandler: (deps: { env: (key: string) => string | undefined;
        rpc: (payload: Record<string, string>) => Promise<unknown> }) => (request: Request) => Promise<Response>;
    };
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const branchId = "22222222-2222-4222-8222-222222222222";
    const entityId = "SYNTHETIC";
    const token = "a1".repeat(32);
    const settings: Record<string, string> = {
      FINANCE_DAYCARE_SUMMARY_TOKEN: token,
      FINANCE_DAYCARE_SUMMARY_BINDING_ID: "33333333-3333-4333-8333-333333333333",
      FINANCE_DAYCARE_SUMMARY_TOKEN_EXPIRES_AT: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const rpc = vi.fn(async (payload: Record<string, string>) => ({ status: "ready", organization_id: payload.p_organization_id,
      branch_id: payload.p_branch_id, month: payload.p_month, entity_id: entityId, entity_name: "合成測試店",
      currency: "TWD", basis: "finance_pnl_ledger", income: "685000.00", expenses: "-4723.50", entry_count: 10,
      generated_at: new Date().toISOString() }));
    const handle = createSummaryHandler({ env: (key) => settings[key], rpc });
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const part of req) chunks.push(Buffer.from(part));
        const response = await handle(new Request(`http://127.0.0.1${req.url}`, {
          method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks),
        }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } catch { res.writeHead(500); res.end(); }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("LOOPBACK_NOT_READY");
    try {
      const url = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/daycare-store-finance-summary";
      // Config remains strict HTTPS; this test transport alone redirects it to
      // loopback. Production has no URL override or synthetic handler import.
      const result = await fetchFinanceSummary({ connection: { url, token, organizationId, branchId, entityId },
        organizationId, branchId, month: "2026-09" }, async (target, init) => {
        expect(target).toBe(url);
        return fetch(`http://127.0.0.1:${address.port}/functions/v1/daycare-store-finance-summary`, init);
      });
      expect(result).toMatchObject({ status: "ready", data: { income: "685000.00", expenses: "-4723.50", entryCount: 10 } });
      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc.mock.calls[0][0]).toEqual({ p_binding_id: settings.FINANCE_DAYCARE_SUMMARY_BINDING_ID,
        p_organization_id: organizationId, p_branch_id: branchId, p_month: "2026-09" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  });
});
