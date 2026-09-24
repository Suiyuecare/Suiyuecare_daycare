import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  clientServiceState,
  isTerminalClientTransition,
  taipeiDate,
} from "./lifecycle-rules";
import type {
  ClientLifecycleClient,
  ClientLifecycleSnapshot,
  ClientLifecycleStatusFilter,
  ClientLifecycleStatus,
  ClientServiceState,
  ClientTransitionInput,
  ClientTransitionKind,
} from "./types";

export type ClientLifecycleClientRow = {
  id: string;
  client_code: string;
  display_name: string;
  status: ClientLifecycleStatus;
  admitted_on: string | null;
  ended_on: string | null;
  row_version: number;
  updated_at: string;
};

export type ClientTransitionRow = {
  id: string;
  client_id: string;
  event_kind: ClientTransitionKind;
  effective_on: string;
  reason: string;
  handoff_note: string | null;
  from_status: ClientLifecycleStatus;
  to_status: ClientLifecycleStatus;
  base_row_version: number;
  resulting_row_version: number;
  actor_user_id: string;
  created_at: string;
};

const transitionInputSchema = z
  .object({
    client_id: z.uuid(),
    event_kind: z.enum([
      "admit",
      "suspend",
      "resume",
      "transfer",
      "close",
      "death",
    ]),
    effective_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    reason: z.string().trim().min(1).max(1_000),
    handoff_note: z.string().trim().max(2_000).nullable().optional(),
    expected_row_version: z.number().int().positive().safe(),
    idempotency_key: z.string().optional(),
  })
  .strict();

function isCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === day
  );
}

export function parseClientTransitionInput(
  value: unknown,
  headerIdempotencyKey?: string | null,
  now = new Date(),
): ClientTransitionInput {
  const parsed = transitionInputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IntegrationError(
      "INVALID_CLIENT_TRANSITION",
      "個案異動欄位格式錯誤。",
      400,
      issue?.path.join(".") || undefined,
    );
  }

  const idempotencyKey = headerIdempotencyKey ?? parsed.data.idempotency_key;
  const idempotency = z.uuid().safeParse(idempotencyKey);
  if (!idempotency.success) {
    throw new IntegrationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "請提供有效的 UUID 冪等鍵。",
      400,
      "idempotency_key",
    );
  }

  if (!isCalendarDate(parsed.data.effective_on)) {
    throw new IntegrationError(
      "INVALID_EFFECTIVE_DATE",
      "生效日期不是有效日期。",
      400,
      "effective_on",
    );
  }
  if (parsed.data.effective_on > taipeiDate(now)) {
    throw new IntegrationError(
      "EFFECTIVE_DATE_IN_FUTURE",
      "生效日期不得晚於台北今日。",
      400,
      "effective_on",
    );
  }

  const handoffNote = parsed.data.handoff_note || null;
  if (
    isTerminalClientTransition(parsed.data.event_kind) &&
    !handoffNote
  ) {
    throw new IntegrationError(
      "HANDOFF_REQUIRED",
      "轉出、結案與死亡事件必須填寫交接內容。",
      400,
      "handoff_note",
    );
  }

  return {
    clientId: parsed.data.client_id,
    eventKind: parsed.data.event_kind,
    effectiveOn: parsed.data.effective_on,
    reason: parsed.data.reason,
    handoffNote,
    expectedRowVersion: parsed.data.expected_row_version,
    idempotencyKey: idempotency.data.toLowerCase(),
  };
}

function projectClient(row: ClientLifecycleClientRow): ClientLifecycleClient {
  const serviceState = clientServiceState({
    status: row.status,
    admittedOn: row.admitted_on,
  });
  return {
    id: row.id,
    clientCode: row.client_code,
    displayName: row.display_name,
    status: row.status,
    serviceState,
    admittedOn: row.admitted_on,
    endedOn: row.ended_on,
    rowVersion: row.row_version,
    updatedAt: row.updated_at,
  };
}

export function projectClientLifecycleSnapshot(input: {
  clientRows: readonly ClientLifecycleClientRow[];
  transitionRows: readonly ClientTransitionRow[];
  currentUserId: string;
  currentUserDisplayName: string;
  visibleActorNames?: ReadonlyMap<string, string>;
  generatedAt?: string;
  metrics?: ClientLifecycleSnapshot["metrics"];
  historyPage?: number;
  historyPageSize?: number;
  historyTotal?: number;
  demo: boolean;
}): ClientLifecycleSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const clients = input.clientRows.map(projectClient);
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const transitions = input.transitionRows.flatMap((row) => {
    const client = clientById.get(row.client_id);
    if (!client) return [];
    const createdByCurrentUser = row.actor_user_id === input.currentUserId;
    return [{
      id: row.id,
      clientId: row.client_id,
      clientCode: client.clientCode,
      clientName: client.displayName,
      eventKind: row.event_kind,
      effectiveOn: row.effective_on,
      reason: row.reason,
      handoffNote: row.handoff_note,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromServiceState:
        (row.event_kind === "admit"
          ? "pending_admission"
          : row.from_status) as ClientServiceState,
      toServiceState: row.to_status as ClientServiceState,
      baseRowVersion: row.base_row_version,
      resultingRowVersion: row.resulting_row_version,
      actorLabel: createdByCurrentUser
        ? `${input.currentUserDisplayName}（本人）`
        : input.visibleActorNames?.get(row.actor_user_id) ?? "已授權工作人員",
      createdByCurrentUser,
      createdAt: row.created_at,
    }];
  });

  const monthPrefix = taipeiDate(new Date(generatedAt)).slice(0, 7);
  return {
    generatedAt,
    clients,
    transitions,
    metrics: input.metrics ?? {
      admittedThisMonth: transitions.filter(
        (item) => item.eventKind === "admit" && item.effectiveOn.startsWith(monthPrefix),
      ).length,
      pendingAdmission: clients.filter(
        (client) => client.serviceState === "pending_admission",
      ).length,
      suspended: clients.filter((client) => client.status === "suspended").length,
      endedThisMonth: transitions.filter(
        (item) =>
          isTerminalClientTransition(item.eventKind) &&
          item.effectiveOn.startsWith(monthPrefix),
      ).length,
      pendingHandoff: transitions.filter(
        (item) => isTerminalClientTransition(item.eventKind) && !item.handoffNote,
      ).length,
    },
    historyPage: input.historyPage ?? 1,
    historyPageSize: input.historyPageSize ?? Math.max(transitions.length, 1),
    historyTotal: input.historyTotal ?? transitions.length,
    demo: input.demo,
  };
}

export function filterClientLifecycleTransitions(
  snapshot: ClientLifecycleSnapshot,
  options: {
    clientId?: string | null;
    query: string;
    status: ClientLifecycleStatusFilter;
    eventKind: "all" | ClientTransitionKind;
    effectiveOn: string | null;
  },
) {
  const normalizedQuery = options.query.trim().toLocaleLowerCase("zh-TW");
  const clientById = new Map(
    snapshot.clients.map((client) => [client.id, client]),
  );
  return snapshot.transitions.filter((transition) => {
    const client = clientById.get(transition.clientId);
    const matchesQuery =
      !normalizedQuery ||
      `${transition.clientName} ${transition.clientCode}`
        .toLocaleLowerCase("zh-TW")
        .includes(normalizedQuery);
    return (
      (!options.clientId || transition.clientId === options.clientId) &&
      matchesQuery &&
      (options.status === "all" || client?.serviceState === options.status) &&
      (options.eventKind === "all" ||
        transition.eventKind === options.eventKind) &&
      (!options.effectiveOn ||
        transition.effectiveOn === options.effectiveOn)
    );
  });
}
