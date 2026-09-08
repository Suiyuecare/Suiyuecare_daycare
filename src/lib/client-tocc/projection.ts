import { z } from "zod";

import type { ClientMasterItem } from "@/lib/clients/master-types";

import {
  CLIENT_TOCC_ACTION_STATUSES,
  CLIENT_TOCC_EVIDENCE_STATUSES,
  CLIENT_TOCC_RESULT_STATUSES,
  CLIENT_TOCC_VALIDITY_RULE,
  CLIENT_TOCC_VALIDITY_STATUSES,
  type ClientToccAssessment,
  type ClientToccClientSummary,
  type ClientToccFilters,
  type ClientToccSnapshot,
} from "./types";
import {
  addCalendarDays,
  calculateToccValidThrough,
  isCalendarDate,
} from "./validation";

const rpcRowSchema = z
  .object({
    assessment_id: z.uuid(),
    client_id: z.uuid(),
    assessment_version: z.number().int().positive().safe(),
    assessment_date: z.string(),
    valid_through: z.string(),
    validity_rule_version: z.literal(CLIENT_TOCC_VALIDITY_RULE),
    validity_status: z.enum(CLIENT_TOCC_VALIDITY_STATUSES),
    result_status: z.enum(CLIENT_TOCC_RESULT_STATUSES),
    symptom_summary: z.string().min(1).max(1_000).nullable(),
    risk_summary: z.string().min(1).max(1_000).nullable(),
    evidence_status: z.enum(CLIENT_TOCC_EVIDENCE_STATUSES),
    action_status: z.enum(CLIENT_TOCC_ACTION_STATUSES),
    signed_at: z.string(),
  })
  .strict();

export type ClientToccSnapshotRpcRow = z.input<typeof rpcRowSchema>;

function invalidProjection(): never {
  throw new Error("INVALID_CLIENT_TOCC_PROJECTION");
}

function parseAssessment(
  value: unknown,
  todayTaipei: string,
): ClientToccAssessment {
  const parsed = rpcRowSchema.safeParse(value);
  if (!parsed.success) invalidProjection();
  const row = parsed.data;
  if (
    !isCalendarDate(row.assessment_date) ||
    row.assessment_date > todayTaipei ||
    !isCalendarDate(row.valid_through) ||
    calculateToccValidThrough(row.assessment_date) !== row.valid_through ||
    (todayTaipei <= row.valid_through ? "current" : "expired") !==
      row.validity_status ||
    !Number.isFinite(new Date(row.signed_at).getTime()) ||
    (row.result_status !== "clear" &&
      !row.symptom_summary &&
      !row.risk_summary) ||
    (row.result_status === "action_required" &&
      row.action_status === "none_required")
  ) {
    invalidProjection();
  }
  return {
    id: row.assessment_id.toLowerCase(),
    clientId: row.client_id.toLowerCase(),
    assessmentVersion: row.assessment_version,
    assessmentDate: row.assessment_date,
    validThrough: row.valid_through,
    validityRuleVersion: row.validity_rule_version,
    validityStatus: row.validity_status,
    resultStatus: row.result_status,
    symptomSummary: row.symptom_summary,
    riskSummary: row.risk_summary,
    evidenceStatus: row.evidence_status,
    actionStatus: row.action_status,
    source: "staff",
    signedAt: new Date(row.signed_at).toISOString(),
  };
}

function countsFor(
  clients: readonly ClientToccClientSummary[],
  todayTaipei: string,
) {
  const expiringThrough = addCalendarDays(todayTaipei, 7);
  return {
    accessibleClients: clients.length,
    current: clients.filter(
      (client) => client.latestAssessment?.validityStatus === "current",
    ).length,
    expiringSoon: clients.filter((client) => {
      const assessment = client.latestAssessment;
      return Boolean(
        assessment &&
          assessment.validityStatus === "current" &&
          assessment.validThrough <= expiringThrough,
      );
    }).length,
    expired: clients.filter(
      (client) => client.latestAssessment?.validityStatus === "expired",
    ).length,
    noRecord: clients.filter((client) => !client.latestAssessment).length,
    actionRequired: clients.filter(
      (client) => client.latestAssessment?.resultStatus === "action_required",
    ).length,
  };
}

export function canRecordClientToccOn(
  client: Pick<
    ClientToccClientSummary,
    "clientStatus" | "admittedOn" | "endedOn"
  >,
  assessmentDate: string,
) {
  return (
    isCalendarDate(assessmentDate) &&
    client.clientStatus === "active" &&
    client.admittedOn !== null &&
    client.admittedOn <= assessmentDate &&
    (client.endedOn === null || client.endedOn >= assessmentDate)
  );
}

export function projectClientToccSnapshot(input: {
  clients: readonly ClientMasterItem[];
  assessmentRows: readonly unknown[];
  generatedAt: string;
  todayTaipei: string;
  demo: boolean;
}): ClientToccSnapshot {
  if (
    !isCalendarDate(input.todayTaipei) ||
    !Number.isFinite(new Date(input.generatedAt).getTime())
  ) {
    invalidProjection();
  }
  const generatedAt = new Date(input.generatedAt).toISOString();
  const clientsById = new Map(input.clients.map((client) => [client.id, client]));
  if (clientsById.size !== input.clients.length) invalidProjection();

  const assessmentByClient = new Map<string, ClientToccAssessment>();
  for (const rawRow of input.assessmentRows) {
    const assessment = parseAssessment(rawRow, input.todayTaipei);
    if (
      !clientsById.has(assessment.clientId) ||
      assessmentByClient.has(assessment.clientId)
    ) {
      invalidProjection();
    }
    assessmentByClient.set(assessment.clientId, assessment);
  }

  const clients = input.clients
    .map(
      (client): ClientToccClientSummary => ({
        clientId: client.id,
        clientCode: client.clientCode,
        displayName: client.displayName,
        clientStatus: client.status,
        admittedOn: client.admittedOn,
        endedOn: client.endedOn,
        canRecord: canRecordClientToccOn(
          {
            clientStatus: client.status,
            admittedOn: client.admittedOn,
            endedOn: client.endedOn,
          },
          input.todayTaipei,
        ),
        latestAssessment: assessmentByClient.get(client.id) ?? null,
      }),
    )
    .sort((left, right) =>
      left.clientCode.localeCompare(right.clientCode, "zh-TW"),
    );

  return {
    generatedAt,
    staleAfter: new Date(new Date(generatedAt).getTime() + 60_000).toISOString(),
    todayTaipei: input.todayTaipei,
    clients,
    counts: countsFor(clients, input.todayTaipei),
    demo: input.demo,
  };
}

export function filterClientToccSnapshot(
  snapshot: ClientToccSnapshot,
  filters: ClientToccFilters,
): ClientToccSnapshot {
  const query = filters.query.trim().toLocaleLowerCase("zh-TW");
  const clients = snapshot.clients.filter((client) => {
    const assessment = client.latestAssessment;
    const matchesQuery =
      !query ||
      `${client.clientCode} ${client.displayName}`
        .toLocaleLowerCase("zh-TW")
        .includes(query);
    const matchesValidity =
      filters.validity === "all" ||
      (filters.validity === "no_record"
        ? assessment === null
        : assessment?.validityStatus === filters.validity);
    const matchesResult =
      filters.result === "all" || assessment?.resultStatus === filters.result;
    return matchesQuery && matchesValidity && matchesResult;
  });
  return {
    ...snapshot,
    clients,
    counts: countsFor(clients, snapshot.todayTaipei),
  };
}
