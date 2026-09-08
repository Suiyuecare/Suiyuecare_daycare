import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import {
  MEDICATION_PLAN_CLIENT_STATUSES,
  MEDICATION_PLAN_LIFECYCLE_STATES,
  MEDICATION_PLAN_WORKFLOW_STATES,
  type MedicationPlanClientOption,
  type MedicationPlanLifecycleState,
  type MedicationPlanRecord,
  type MedicationPlanSnapshot,
  type MedicationPlanWorkflowState,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

export type MedicationPlanSourceRow = {
  plan_id: string;
  record_key: string;
  version: number | string;
  previous_version_id: string | null;
  client_id: string;
  medication_name: string;
  dose: number | string;
  dose_unit: string;
  medication_route: string;
  schedule: unknown;
  high_risk: boolean;
  effective_from: string;
  effective_to: string | null;
  workflow_state: string;
  submitted_by_current_actor: boolean;
  lifecycle_state: string;
  submitted_at: string | null;
  approved_at: string | null;
  terminated_at: string | null;
  termination_kind: string | null;
  termination_reason: string | null;
  replacement_plan_id: string | null;
  row_version: number | string;
};

function invalid(): never {
  throw new Error("INVALID_MEDICATION_PLAN_PROJECTION");
}

function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function optionalUuid(value: unknown) {
  return value === null ? null : uuid(value);
}

function text(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum ||
    CONTROL_PATTERN.test(value)
  ) {
    invalid();
  }
  return value.trim();
}

function optionalText(value: unknown, maximum: number) {
  return value === null ? null : text(value, maximum);
}

function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !isStrictOffsetDateTime(value)
  ) {
    invalid();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown) {
  return value === null ? null : timestamp(value);
}

function calendarDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid();
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid();
  }
  return value;
}

function optionalDate(value: unknown) {
  return value === null ? null : calendarDate(value);
}

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid();
  return parsed;
}

function dose(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > 100_000 ||
    Math.abs(parsed * 10_000 - Math.round(parsed * 10_000)) > 1e-7
  ) {
    invalid();
  }
  return parsed;
}

function schedule(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== 1 ||
    !("times" in object) ||
    !Array.isArray(object.times) ||
    object.times.length < 1 ||
    object.times.length > 24 ||
    Buffer.byteLength(JSON.stringify(object), "utf8") > 512
  ) {
    invalid();
  }
  const times = object.times.map((item) => {
    if (typeof item !== "string" || !TIME_PATTERN.test(item)) invalid();
    return item;
  });
  if (new Set(times).size !== times.length) invalid();
  return { times: times.sort() };
}

function parseRow(
  row: MedicationPlanSourceRow,
  generatedAt: string,
  expectedClientId: string,
): MedicationPlanRecord {
  if (
    !MEDICATION_PLAN_WORKFLOW_STATES.includes(
      row.workflow_state as MedicationPlanWorkflowState,
    ) ||
    !MEDICATION_PLAN_LIFECYCLE_STATES.includes(
      row.lifecycle_state as MedicationPlanLifecycleState,
    ) ||
    typeof row.high_risk !== "boolean" ||
    typeof row.submitted_by_current_actor !== "boolean"
  ) {
    invalid();
  }
  const workflowState = row.workflow_state as MedicationPlanWorkflowState;
  const lifecycleState = row.lifecycle_state as MedicationPlanLifecycleState;
  const submittedAt = optionalTimestamp(row.submitted_at);
  const approvedAt = optionalTimestamp(row.approved_at);
  const terminatedAt = optionalTimestamp(row.terminated_at);
  const terminationKind = row.termination_kind;
  const terminationReason = optionalText(row.termination_reason, 1_000);
  const replacementPlanId = optionalUuid(row.replacement_plan_id);
  const effectiveFrom = timestamp(row.effective_from);
  const effectiveTo = optionalTimestamp(row.effective_to);
  const clientId = uuid(row.client_id);

  if (clientId !== expectedClientId) invalid();

  if (effectiveTo && effectiveTo <= effectiveFrom) invalid();
  if (workflowState === "draft") {
    if (
      lifecycleState !== "draft" ||
      submittedAt ||
      approvedAt ||
      terminatedAt ||
      terminationKind ||
      terminationReason ||
      replacementPlanId ||
      row.submitted_by_current_actor
    ) {
      invalid();
    }
  } else if (workflowState === "submitted") {
    if (
      lifecycleState !== "submitted" ||
      !submittedAt ||
      approvedAt ||
      terminatedAt ||
      terminationKind ||
      terminationReason ||
      replacementPlanId
    ) {
      invalid();
    }
  } else {
    if (!submittedAt || !approvedAt || submittedAt > approvedAt) invalid();
    const hasTermination = terminatedAt !== null;
    if (
      hasTermination !== (terminationKind !== null) ||
      hasTermination !== (terminationReason !== null) ||
      (terminationKind !== null &&
        !["stopped", "replaced"].includes(terminationKind)) ||
      (terminationKind === "stopped" && replacementPlanId !== null) ||
      (terminationKind === "replaced" && replacementPlanId === null)
    ) {
      invalid();
    }
    const terminationReached = Boolean(
      terminatedAt && terminatedAt <= generatedAt,
    );
    if (
      (lifecycleState === "stopped" &&
        (!terminationReached || terminationKind !== "stopped")) ||
      (lifecycleState === "replaced" &&
        (!terminationReached || terminationKind !== "replaced")) ||
      (["scheduled", "active", "expired"] as const).includes(
        lifecycleState as "scheduled" | "active" | "expired",
      ) &&
        terminationReached
    ) {
      invalid();
    }
    if (
      lifecycleState === "scheduled" &&
      effectiveFrom <= generatedAt
    ) {
      invalid();
    }
    if (
      lifecycleState === "expired" &&
      (!effectiveTo || effectiveTo > generatedAt)
    ) {
      invalid();
    }
    if (
      lifecycleState === "active" &&
      (effectiveFrom > generatedAt || (effectiveTo && effectiveTo <= generatedAt))
    ) {
      invalid();
    }
  }

  return {
    id: uuid(row.plan_id),
    recordKey: uuid(row.record_key),
    version: integer(row.version),
    previousVersionId: optionalUuid(row.previous_version_id),
    clientId,
    medicationName: text(row.medication_name, 200),
    dose: dose(row.dose),
    doseUnit: text(row.dose_unit, 32),
    route: text(row.medication_route, 80),
    schedule: schedule(row.schedule),
    highRisk: row.high_risk,
    effectiveFrom,
    effectiveTo,
    workflowState,
    submittedByCurrentActor: row.submitted_by_current_actor,
    lifecycleState,
    submittedAt,
    approvedAt,
    terminatedAt,
    terminationKind: terminationKind as "stopped" | "replaced" | null,
    terminationReason,
    replacementPlanId,
    rowVersion: integer(row.row_version),
  };
}

export function projectMedicationPlanRows(input: {
  rows: readonly MedicationPlanSourceRow[];
  generatedAt: string;
  expectedClientId: string;
}) {
  const generatedAt = timestamp(input.generatedAt);
  const expectedClientId = uuid(input.expectedClientId);
  const plans = input.rows.map((row) =>
    parseRow(row, generatedAt, expectedClientId),
  );
  const ids = new Set<string>();
  const streamVersions = new Set<string>();
  for (const plan of plans) {
    if (
      ids.has(plan.id) ||
      streamVersions.has(`${plan.recordKey}:${plan.version}`)
    ) {
      invalid();
    }
    ids.add(plan.id);
    streamVersions.add(`${plan.recordKey}:${plan.version}`);
  }
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  for (const plan of plans) {
    if (plan.version === 1 && plan.previousVersionId !== null) invalid();
    if (plan.version > 1) {
      const previous = plan.previousVersionId
        ? byId.get(plan.previousVersionId)
        : null;
      if (
        !previous ||
        previous.recordKey !== plan.recordKey ||
        previous.version !== plan.version - 1
      ) {
        invalid();
      }
    }
    if (plan.replacementPlanId) {
      const replacement = byId.get(plan.replacementPlanId);
      if (
        !replacement ||
        replacement.previousVersionId !== plan.id ||
        replacement.recordKey !== plan.recordKey ||
        replacement.version !== plan.version + 1
      ) {
        invalid();
      }
    }
  }

  return plans.sort((left, right) => {
    const byMedication = left.medicationName.localeCompare(
      right.medicationName,
      "zh-TW",
    );
    if (byMedication !== 0) return byMedication;
    const byStream = left.recordKey.localeCompare(right.recordKey);
    return byStream !== 0 ? byStream : right.version - left.version;
  });
}

export function medicationPlanMetrics(
  plans: readonly MedicationPlanRecord[],
  generatedAt: string,
) {
  const now = new Date(generatedAt).getTime();
  const soon = now + 30 * 24 * 60 * 60 * 1_000;
  const recent = now - 7 * 24 * 60 * 60 * 1_000;
  return {
    active: plans.filter((plan) => plan.lifecycleState === "active").length,
    expiringSoon: plans.filter((plan) => {
      if (!plan.effectiveTo || !["active", "scheduled"].includes(plan.lifecycleState)) {
        return false;
      }
      const end = new Date(plan.effectiveTo).getTime();
      return end > now && end <= soon;
    }).length,
    recentChanges: plans.filter((plan) =>
      [plan.submittedAt, plan.approvedAt, plan.terminatedAt].some(
        (value) => value !== null && new Date(value).getTime() >= recent,
      ),
    ).length,
    pendingApproval: plans.filter(
      (plan) => plan.workflowState === "submitted",
    ).length,
  };
}

export function medicationPlanIncomingCutoverTargets(
  plans: readonly MedicationPlanRecord[],
  generatedAt: string,
) {
  const generated = timestamp(generatedAt);
  return new Set(
    plans
      .filter(
        (plan) =>
          plan.terminationKind === "replaced" &&
          plan.terminatedAt !== null &&
          plan.terminatedAt > generated &&
          plan.replacementPlanId !== null,
      )
      .map((plan) => plan.replacementPlanId!),
  );
}

export function medicationPlanActionEligibility(
  plan: MedicationPlanRecord,
  plans: readonly MedicationPlanRecord[],
  generatedAt: string,
) {
  const latestVersion = plans
    .filter((candidate) => candidate.recordKey === plan.recordKey)
    .every((candidate) => candidate.version <= plan.version);
  const lockedByFutureCutover = medicationPlanIncomingCutoverTargets(
    plans,
    generatedAt,
  ).has(plan.id);
  const approvedCurrentOrFuture =
    plan.workflowState === "approved" &&
    ["active", "scheduled"].includes(plan.lifecycleState) &&
    plan.terminationKind === null;
  return {
    latestVersion,
    lockedByFutureCutover,
    canRevise:
      approvedCurrentOrFuture && latestVersion && !lockedByFutureCutover,
    // A newer draft must never hide the stop action for the currently
    // approved plan.  Only an immutable future cutover locks that operation.
    canStop: approvedCurrentOrFuture && !lockedByFutureCutover,
  };
}

export function projectMedicationPlanSnapshot(input: {
  rows: readonly MedicationPlanSourceRow[];
  clients: readonly MedicationPlanClientOption[];
  selectedClient: MedicationPlanClientOption | null;
  generatedAt: string;
  demo: boolean;
}): MedicationPlanSnapshot {
  const generatedAt = timestamp(input.generatedAt);
  const clientIds = new Set<string>();
  const clients = input.clients.map((client) => {
    const id = uuid(client.id);
    if (clientIds.has(id)) invalid();
    clientIds.add(id);
    if (
      !MEDICATION_PLAN_CLIENT_STATUSES.includes(client.status) ||
      typeof client.canCreatePlan !== "boolean"
    ) {
      invalid();
    }
    const admittedOn = optionalDate(client.admittedOn);
    const endedOn = optionalDate(client.endedOn);
    const canCreatePlan =
      client.status === "active" && admittedOn !== null && endedOn === null;
    if (client.canCreatePlan !== canCreatePlan) invalid();
    return {
      id,
      code: text(client.code, 64),
      displayName: text(client.displayName, 120),
      status: client.status,
      admittedOn,
      endedOn,
      canCreatePlan,
    };
  });
  const selectedClient = input.selectedClient
    ? clients.find((client) => client.id === uuid(input.selectedClient!.id)) ??
      invalid()
    : null;
  if (!selectedClient && (clients.length > 0 || input.rows.length > 0)) invalid();
  const plans = selectedClient
    ? projectMedicationPlanRows({
        rows: input.rows,
        generatedAt,
        expectedClientId: selectedClient.id,
      })
    : [];
  return {
    generatedAt,
    staleAfter: new Date(
      new Date(generatedAt).getTime() + 60_000,
    ).toISOString(),
    selectedClient,
    clients,
    plans,
    metrics: medicationPlanMetrics(plans, generatedAt),
    demo: input.demo,
  };
}
