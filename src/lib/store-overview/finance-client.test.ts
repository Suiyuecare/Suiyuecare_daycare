import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchFinanceSummary, financeConnection, type FinanceConnection } from "./finance-client";
import { formatTwd } from "./types";

const connection: FinanceConnection = {
  url: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/daycare-store-finance-summary",
  token: "a1".repeat(32), entityId: "TEST_STORE",
  organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222",
};
const input = { connection, organizationId: connection.organizationId, branchId: connection.branchId, month: "2026-09" };
function fakeResponse(change: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    return Response.json({ ...body, status: "ready", entity_id: connection.entityId, entity_name: "合成店",
      currency: "TWD", basis: "finance_pnl_ledger", income: "685000.00", expenses: "-4723.50",
      entry_count: 36, generated_at: new Date().toISOString(), ...change });
  });
}
afterEach(() => vi.restoreAllMocks());
describe("Finance single-store server bridge", () => {
  it("reads exact signed decimal totals and discards source identity metadata", async () => {
    const fetcher = fakeResponse();
    const result = await fetchFinanceSummary(input, fetcher);
    expect(result).toEqual({ status: "ready", data: { income: "685000.00", expenses: "-4723.50",
      entryCount: 36, generatedAt: expect.any(String) } });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(connection.url);
    expect(options).toMatchObject({ method: "POST", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${connection.token}` } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options!.body as string)).toEqual({ request_id: expect.any(String),
      organization_id: connection.organizationId, branch_id: connection.branchId, month: "2026-09" });
    expect(JSON.stringify(result)).not.toContain(connection.token);
    expect(JSON.stringify(result)).not.toContain("entity_id");
  });
  it.each([
    { request_id: "99999999-9999-4999-8999-999999999999" }, { organization_id: connection.branchId },
    { branch_id: connection.organizationId }, { month: "2026-08" }, { entity_id: "OTHER_STORE" },
    { currency: "USD" }, { basis: "cash" }, { income: 685000 }, { expenses: "1e8" },
    { income: "NaN" }, { income: "123.456" }, { income: "001.00" }, { entry_count: -1 },
    { entry_count: 0 }, { generated_at: "2020-01-01T00:00:00Z" },
    { generated_at: "2200-01-01T00:00:00Z" }, { extra_ledger_rows: [] },
  ])("rejects mismatched or malformed response %j instead of showing false totals", async (change) => {
    expect(await fetchFinanceSummary(input, fakeResponse(change))).toEqual({ status: "unavailable" });
  });
  it("accepts genuine empty month zero totals", async () => {
    expect(await fetchFinanceSummary(input, fakeResponse({ income: "0.00", expenses: "0.00", entry_count: 0 })))
      .toMatchObject({ status: "ready", data: { income: "0.00", expenses: "0.00", entryCount: 0 } });
  });
  it.each([null, { ...connection, branchId: connection.organizationId }, { ...connection, token: "short" },
    { ...connection, url: "https://evil.invalid/functions/v1/daycare-store-finance-summary" },
    { ...connection, url: `${connection.url}?token=secret` },
    { ...connection, url: `${connection.url}#fragment` },
    { ...connection, url: connection.url.replace("https://", "http://") },
  ])("does not contact unconfigured or mismatched connection", async (config) => {
    const fetcher = fakeResponse();
    expect(await fetchFinanceSummary({ ...input, connection: config }, fetcher)).toEqual({ status: "not_connected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["2026-13", "1999-12", "2201-01", "2026-09&entity=OTHER"])("rejects invalid month %s", async (month) => {
    const fetcher = fakeResponse();
    expect(await fetchFinanceSummary({ ...input, month }, fetcher)).toEqual({ status: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([403, 500, 302, 429])("returns only safe error status for HTTP %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private ledger secret", { status }));
    expect(await fetchFinanceSummary(input, fetcher)).toEqual({ status: "unavailable" });
  });
  it("distinguishes a timeout", async () => {
    expect(await fetchFinanceSummary(input, vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 504 }))))
      .toEqual({ status: "timeout" });
  });
  it("does not leak thrown errors or malformed JSON/oversized bodies", async () => {
    for (const response of [new Response("broken", { headers: { "Content-Type": "application/json" } }),
      Response.json({ huge: "x".repeat(17_000) }), new Response("<html>private</html>")]) {
      expect(await fetchFinanceSummary(input, vi.fn<typeof fetch>().mockResolvedValue(response))).toEqual({ status: "unavailable" });
    }
    expect(await fetchFinanceSummary(input, vi.fn<typeof fetch>().mockRejectedValue(new Error(connection.token))))
      .toEqual({ status: "unavailable" });
  });
  it("keeps incomplete settings disabled without throwing secret-bearing validation errors", () => {
    expect(financeConnection({})).toBeNull();
    expect(financeConnection({ FINANCE_STORE_SUMMARY_TOKEN: "secret" })).toBeNull();
    expect(financeConnection({ FINANCE_STORE_SUMMARY_URL: connection.url, FINANCE_STORE_SUMMARY_TOKEN: connection.token,
      FINANCE_STORE_ORGANIZATION_ID: connection.organizationId, FINANCE_STORE_BRANCH_ID: connection.branchId,
      FINANCE_STORE_ENTITY_ID: connection.entityId })).toEqual(connection);
  });
});
describe("exact currency formatting", () => {
  it.each([["685000.00", "685,000"], ["-4723.50", "-4,723.50"], ["0.00", "0"],
    ["999999999999999999.99", "999,999,999,999,999,999.99"], ["NaN", "—"]])("formats %s", (input, output) => {
    expect(formatTwd(input)).toBe(output);
  });
});
