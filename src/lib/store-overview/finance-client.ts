import "server-only";

import { z } from "zod";
import type { FinanceSummary, SummarySource } from "./types";
import { financeConnectionSchema as configSchema, type FinanceConnection } from "./finance-configuration";
export { financeConnection, type FinanceConnection } from "./finance-configuration";
const money = z.string().regex(/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/u);
const responseSchema = z.object({
  request_id: z.uuid(), status: z.literal("ready"),
  organization_id: z.uuid(), branch_id: z.uuid(),
  month: z.string(), entity_id: z.string(), entity_name: z.string().min(1).max(500),
  currency: z.literal("TWD"), basis: z.literal("finance_pnl_ledger"),
  income: money, expenses: money, entry_count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  generated_at: z.iso.datetime({ offset: true }),
}).strict();

async function readSmallJson(response: Response) {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("INVALID_RESPONSE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("INVALID_RESPONSE");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) throw new Error("INVALID_RESPONSE");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Called only after the daycare database gate. No user JWT, names, client details, or accounting writes. */
export async function fetchFinanceSummary({ connection, organizationId, branchId, month }: {
  connection: FinanceConnection | null; organizationId: string; branchId: string; month: string;
}, fetcher: typeof fetch = fetch): Promise<SummarySource<FinanceSummary>> {
  if (!connection || !configSchema.safeParse(connection).success ||
      connection.organizationId !== organizationId || connection.branchId !== branchId) {
    return { status: "not_connected" };
  }
  if (!/^(?:20\d{2}|21\d{2}|2200)-(?:0[1-9]|1[0-2])$/u.test(month)) return { status: "unavailable" };
  const requestId = crypto.randomUUID();
  const signal = AbortSignal.timeout(5_000);
  try {
    const response = await fetcher(connection.url, {
      method: "POST", cache: "no-store", redirect: "error", signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${connection.token}` },
      body: JSON.stringify({ request_id: requestId, organization_id: organizationId, branch_id: branchId, month }),
    });
    if (!response.ok) return { status: response.status === 504 ? "timeout" : "unavailable" };
    const parsed = responseSchema.safeParse(await readSmallJson(response));
    if (!parsed.success) return { status: "unavailable" };
    const value = parsed.data;
    const age = Date.now() - Date.parse(value.generated_at);
    if (value.request_id !== requestId || value.organization_id !== organizationId ||
        value.branch_id !== branchId || value.month !== month || value.entity_id !== connection.entityId ||
        age > 60_000 || age < -30_000 ||
        (value.entry_count === 0 && (Number(value.income) !== 0 || Number(value.expenses) !== 0))) {
      return { status: "unavailable" };
    }
    return { status: "ready", data: { income: value.income, expenses: value.expenses,
      entryCount: value.entry_count, generatedAt: value.generated_at } };
  } catch {
    // Never propagate endpoint bodies, authorization values, or stack traces.
    return { status: signal.aborted ? "timeout" : "unavailable" };
  }
}
