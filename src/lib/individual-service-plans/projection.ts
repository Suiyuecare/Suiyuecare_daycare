import { z } from "zod";

import type { ClientMasterItem } from "@/lib/clients/master-types";

import { isPlanMonth, planMonthLastDate } from "./date";
import {
  INDIVIDUAL_PLAN_PROGRESS,
  type IndividualPlanClient,
  type IndividualPlanFilters,
  type IndividualPlanItem,
  type IndividualPlanResponsible,
  type IndividualServicePlan,
  type IndividualServicePlanSnapshot,
} from "./types";

const itemSchema = z
  .object({
    item_order: z.number().int().min(1).max(20),
    goal: z.string().min(1).max(500),
    activity: z.string().min(1).max(1_000),
    frequency: z.string().min(1).max(240),
    responsible_user_id: z.uuid(),
    responsible_display_name: z.string().min(1).max(120),
    progress_status: z.enum(INDIVIDUAL_PLAN_PROGRESS),
    progress_note: z.string().min(1).max(1_000).nullable(),
  })
  .strict();

const planRowSchema = z
  .object({
    plan_id: z.uuid(),
    client_id: z.uuid(),
    plan_month: z.string(),
    plan_version: z.number().int().positive().safe(),
    previous_plan_id: z.uuid().nullable(),
    correction_reason: z.string().min(1).max(1_000).nullable(),
    plan_items: z.array(itemSchema).min(1).max(20),
    signed_at: z.string(),
  })
  .strict();

const responsibleRowSchema = z
  .object({ user_id: z.uuid(), display_name: z.string().min(1).max(120) })
  .strict();

function invalid(): never {
  throw new Error("INVALID_INDIVIDUAL_SERVICE_PLAN_PROJECTION");
}

export function canPlanClientForMonth(
  client: Pick<ClientMasterItem, "admittedOn" | "endedOn">,
  planMonth: string,
) {
  return Boolean(
    isPlanMonth(planMonth) &&
      client.admittedOn &&
      client.admittedOn <= planMonthLastDate(planMonth) &&
      (!client.endedOn || client.endedOn >= `${planMonth}-01`),
  );
}

function parsePlan(raw: unknown, expectedMonth: string): IndividualServicePlan {
  const parsed = planRowSchema.safeParse(raw);
  if (!parsed.success) invalid();
  const row = parsed.data;
  if (
    row.plan_month !== `${expectedMonth}-01` ||
    !Number.isFinite(new Date(row.signed_at).getTime()) ||
    (row.plan_version === 1) !== (row.previous_plan_id === null) ||
    (row.plan_version === 1) !== (row.correction_reason === null) ||
    row.plan_items.some((item, index) => item.item_order !== index + 1)
  ) {
    invalid();
  }
  return {
    id: row.plan_id.toLowerCase(),
    clientId: row.client_id.toLowerCase(),
    planMonth: expectedMonth,
    version: row.plan_version,
    previousPlanId: row.previous_plan_id?.toLowerCase() ?? null,
    correctionReason: row.correction_reason,
    signedAt: new Date(row.signed_at).toISOString(),
    items: row.plan_items.map(
      (item): IndividualPlanItem => ({
        itemOrder: item.item_order,
        goal: item.goal,
        activity: item.activity,
        frequency: item.frequency,
        responsibleUserId: item.responsible_user_id.toLowerCase(),
        responsibleDisplayName: item.responsible_display_name,
        progressStatus: item.progress_status,
        progressNote: item.progress_note,
      }),
    ),
  };
}

function counts(clients: readonly IndividualPlanClient[]) {
  const items = clients.flatMap((client) => client.latestPlan?.items ?? []);
  return {
    plans: clients.filter((client) => client.latestPlan).length,
    notStarted: items.filter((item) => item.progressStatus === "not_started").length,
    inProgress: items.filter((item) => item.progressStatus === "in_progress").length,
    completed: items.filter((item) => item.progressStatus === "completed").length,
  };
}

export function projectIndividualServicePlanSnapshot(input: {
  clients: readonly ClientMasterItem[];
  planRows: readonly unknown[];
  responsibleRows: readonly unknown[];
  planMonth: string;
  generatedAt: string;
  demo: boolean;
}): IndividualServicePlanSnapshot {
  if (!isPlanMonth(input.planMonth) || !Number.isFinite(new Date(input.generatedAt).getTime())) invalid();
  const clientMap = new Map(input.clients.map((client) => [client.id, client]));
  if (clientMap.size !== input.clients.length) invalid();
  const plans = new Map<string, IndividualServicePlan>();
  for (const raw of input.planRows) {
    const plan = parsePlan(raw, input.planMonth);
    if (!clientMap.has(plan.clientId) || plans.has(plan.clientId)) invalid();
    plans.set(plan.clientId, plan);
  }
  const responsibleMap = new Map<string, IndividualPlanResponsible>();
  for (const raw of input.responsibleRows) {
    const parsed = responsibleRowSchema.safeParse(raw);
    if (!parsed.success || responsibleMap.has(parsed.data.user_id.toLowerCase())) invalid();
    responsibleMap.set(parsed.data.user_id.toLowerCase(), {
      userId: parsed.data.user_id.toLowerCase(),
      displayName: parsed.data.display_name,
    });
  }
  const clients = input.clients
    .map((client): IndividualPlanClient => ({
      clientId: client.id,
      clientCode: client.clientCode,
      displayName: client.displayName,
      clientStatus: client.status,
      admittedOn: client.admittedOn,
      endedOn: client.endedOn,
      canPlanMonth: canPlanClientForMonth(client, input.planMonth),
      latestPlan: plans.get(client.id) ?? null,
    }))
    .sort((a, b) => a.clientCode.localeCompare(b.clientCode, "zh-TW"));
  const generatedAt = new Date(input.generatedAt).toISOString();
  return {
    generatedAt,
    staleAfter: new Date(new Date(generatedAt).getTime() + 60_000).toISOString(),
    planMonth: input.planMonth,
    demo: input.demo,
    clients,
    responsibles: [...responsibleMap.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "zh-TW"),
    ),
    counts: counts(clients),
  };
}

export function filterIndividualServicePlanSnapshot(
  snapshot: IndividualServicePlanSnapshot,
  filters: IndividualPlanFilters,
): IndividualServicePlanSnapshot {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const clients = snapshot.clients.filter((client) => {
    const items = client.latestPlan?.items ?? [];
    return (
      (!query || `${client.clientCode} ${client.displayName}`.toLocaleLowerCase("zh-TW").includes(query)) &&
      (filters.responsible === "all" || items.some((item) => item.responsibleUserId === filters.responsible)) &&
      (filters.progress === "all" || items.some((item) => item.progressStatus === filters.progress))
    );
  });
  return { ...snapshot, clients, counts: counts(clients) };
}
