import type {
  MedicationActor,
  MedicationAdministrationCounts,
  MedicationAdministrationRecord,
  MedicationAdministrationSnapshot,
  MedicationClientOption,
  MedicationFilters,
  MedicationFinalizationState,
  MedicationRecordStatus,
} from "./types";
import { MEDICATION_RECORD_STATUSES } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXCEPTION_STATUSES = new Set<MedicationRecordStatus>([
  "refused",
  "held",
  "missed",
]);
const FINALIZATION_STATES = new Set<MedicationFinalizationState>([
  "scheduled",
  "pending_verification",
  "signed",
]);
const EXECUTION_SOURCES = new Set(["staff", "staff_backfill"]);
const CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type MedicationAdministrationSourceRow = {
  administration_id: string;
  client_id: string;
  client_code: string;
  client_display_name: string;
  medication_plan_id: string;
  medication_name: string;
  planned_dose: number | string;
  dose_unit: string;
  medication_route: string;
  high_risk: boolean;
  scheduled_for: string;
  occurred_at: string | null;
  execution_signed_at: string | null;
  status: string;
  actual_dose: number | string | null;
  actual_dose_unit: string | null;
  reason: string | null;
  execution_source: string | null;
  late_entry: boolean;
  requires_second_verification: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  second_verified_by: string | null;
  second_verified_by_name: string | null;
  second_verified_at: string | null;
  signed_at: string | null;
  finalization_state: string;
};

function invalid(): never {
  throw new Error("INVALID_MEDICATION_ADMINISTRATION_PROJECTION");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requiredText(value: unknown, max = 240) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max
  ) {
    invalid();
  }
  return value.trim();
}

function optionalText(value: unknown, max = 1_000) {
  if (value === null) return null;
  return requiredText(value, max);
}

function timestamp(value: unknown) {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown) {
  return value === null ? null : timestamp(value);
}

function taipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function serviceDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    invalid();
  }
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(parsed.getTime()) || taipeiDate(parsed.toISOString()) !== value) {
    invalid();
  }
  return value;
}

function finitePositive(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 99_999_999.9999) {
    invalid();
  }
  return parsed;
}

function actor(id: unknown, name: unknown): MedicationActor | null {
  if (id === null && name === null) return null;
  if (!isUuid(id)) invalid();
  return { id, displayName: requiredText(name, 160) };
}

function equalDose(left: number, right: number) {
  return Math.abs(left - right) <= 0.000_000_1;
}

function parseRow(
  row: MedicationAdministrationSourceRow,
): MedicationAdministrationRecord {
  if (
    !isUuid(row.administration_id) ||
    !isUuid(row.client_id) ||
    !isUuid(row.medication_plan_id) ||
    !MEDICATION_RECORD_STATUSES.includes(row.status as MedicationRecordStatus) ||
    !FINALIZATION_STATES.has(row.finalization_state as MedicationFinalizationState) ||
    typeof row.high_risk !== "boolean" ||
    typeof row.late_entry !== "boolean" ||
    typeof row.requires_second_verification !== "boolean"
  ) {
    invalid();
  }

  const status = row.status as MedicationRecordStatus;
  const finalizationState =
    row.finalization_state as MedicationFinalizationState;
  const plannedDose = finitePositive(row.planned_dose);
  const actualDose =
    row.actual_dose === null ? null : finitePositive(row.actual_dose);
  const doseUnit = requiredText(row.dose_unit, 32);
  const actualDoseUnit = optionalText(row.actual_dose_unit, 32);
  const occurredAt = optionalTimestamp(row.occurred_at);
  const executionSignedAt = optionalTimestamp(row.execution_signed_at);
  const scheduledFor = timestamp(row.scheduled_for);
  const reason = optionalText(row.reason);
  const executionSource = optionalText(row.execution_source, 40);
  const executor = actor(row.recorded_by, row.recorded_by_name);
  const verifier = actor(
    row.second_verified_by,
    row.second_verified_by_name,
  );
  const secondVerifiedAt = optionalTimestamp(row.second_verified_at);
  const signedAt = optionalTimestamp(row.signed_at);

  if (status === "scheduled") {
    if (
      finalizationState !== "scheduled" ||
      occurredAt !== null ||
      executionSignedAt !== null ||
      actualDose !== null ||
      actualDoseUnit !== null ||
      reason !== null ||
      row.late_entry ||
      executor !== null ||
      verifier !== null ||
      secondVerifiedAt !== null ||
      signedAt !== null
    ) {
      invalid();
    }
  } else {
    if (
      !occurredAt ||
      !executionSignedAt ||
      !executor ||
      !executionSource ||
      !EXECUTION_SOURCES.has(executionSource) ||
      finalizationState === "scheduled"
    ) {
      invalid();
    }
    if (status === "administered") {
      if (
        actualDose === null ||
        actualDoseUnit !== doseUnit ||
        !equalDose(actualDose, plannedDose)
      ) {
        invalid();
      }
    } else if (actualDose !== null || actualDoseUnit !== null || !reason) {
      invalid();
    }

    const occurredMs = new Date(occurredAt).getTime();
    const executionSignedMs = new Date(executionSignedAt).getTime();
    const scheduledMs = new Date(scheduledFor).getTime();
    const computedLateEntry =
      occurredMs < executionSignedMs - 60 * 60 * 1_000 ||
      scheduledMs < executionSignedMs - 60 * 60 * 1_000;
    if (
      executionSignedMs + CLOCK_SKEW_MS < occurredMs ||
      row.late_entry !== computedLateEntry ||
      executionSource !== (computedLateEntry ? "staff_backfill" : "staff") ||
      (computedLateEntry && !row.requires_second_verification)
    ) {
      invalid();
    }
  }

  if (finalizationState === "pending_verification") {
    if (
      !row.requires_second_verification ||
      verifier !== null ||
      secondVerifiedAt !== null ||
      signedAt !== null
    ) {
      invalid();
    }
  }

  if (finalizationState === "signed") {
    if (!signedAt) invalid();
    if (
      row.requires_second_verification &&
      (!verifier ||
        !secondVerifiedAt ||
        verifier.id === executor?.id ||
        secondVerifiedAt !== signedAt ||
        (executionSignedAt !== null && secondVerifiedAt < executionSignedAt))
    ) {
      invalid();
    }
    if (
      !row.requires_second_verification &&
      (verifier || secondVerifiedAt || signedAt !== executionSignedAt)
    ) {
      invalid();
    }
  }

  if (
    status !== "scheduled" &&
    row.high_risk &&
    !row.requires_second_verification
  ) {
    invalid();
  }

  return {
    id: row.administration_id,
    clientId: row.client_id,
    clientCode: requiredText(row.client_code, 80),
    clientDisplayName: requiredText(row.client_display_name, 160),
    medicationPlanId: row.medication_plan_id,
    medicationName: requiredText(row.medication_name, 240),
    plannedDose,
    doseUnit,
    route: requiredText(row.medication_route, 80),
    highRisk: row.high_risk,
    scheduledFor,
    occurredAt,
    executionSignedAt,
    status,
    actualDose,
    actualDoseUnit,
    reason,
    executionSource,
    lateEntry: row.late_entry,
    requiresSecondVerification: row.requires_second_verification,
    executor,
    verifier,
    secondVerifiedAt,
    signedAt,
    finalizationState,
  };
}

export function medicationCounts(
  rows: readonly MedicationAdministrationRecord[],
): MedicationAdministrationCounts {
  return {
    due: rows.length,
    completed: rows.filter((row) => row.finalizationState === "signed").length,
    pending: rows.filter((row) => row.finalizationState !== "signed").length,
    exceptions: rows.filter((row) => EXCEPTION_STATUSES.has(row.status)).length,
  };
}

export function projectMedicationAdministrationSnapshot(input: {
  serviceDate: string;
  generatedAt: string;
  rows: readonly MedicationAdministrationSourceRow[];
  demo?: boolean;
}): MedicationAdministrationSnapshot {
  const projectedServiceDate = serviceDate(input.serviceDate);
  const generatedAt = timestamp(input.generatedAt);
  const rows = input.rows.map(parseRow).sort((left, right) => {
    const byTime = left.scheduledFor.localeCompare(right.scheduledFor);
    if (byTime !== 0) return byTime;
    const byClient = left.clientCode.localeCompare(right.clientCode, "zh-TW");
    return byClient !== 0
      ? byClient
      : left.medicationName.localeCompare(right.medicationName, "zh-TW");
  });
  const uniqueSlots = new Set<string>();
  for (const row of rows) {
    if (taipeiDate(row.scheduledFor) !== projectedServiceDate) invalid();
    const slot = `${row.medicationPlanId}:${row.scheduledFor}`;
    if (uniqueSlots.has(slot)) invalid();
    uniqueSlots.add(slot);
  }

  return {
    serviceDate: projectedServiceDate,
    generatedAt,
    staleAfter: new Date(new Date(generatedAt).getTime() + 60_000).toISOString(),
    rows,
    counts: medicationCounts(rows),
    demo: input.demo ?? false,
  };
}

export function filterMedicationAdministrationSnapshot(
  snapshot: MedicationAdministrationSnapshot,
  filters: MedicationFilters,
): MedicationAdministrationSnapshot {
  const rows = snapshot.rows.filter((row) => {
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.status === "all") return true;
    if (filters.status === "pending_verification") {
      return row.finalizationState === "pending_verification";
    }
    return row.status === filters.status;
  });
  return { ...snapshot, rows, counts: medicationCounts(rows) };
}

export function medicationClientOptions(
  snapshot: MedicationAdministrationSnapshot,
): MedicationClientOption[] {
  const unique = new Map<string, MedicationClientOption>();
  for (const row of snapshot.rows) {
    unique.set(row.clientId, {
      id: row.clientId,
      code: row.clientCode,
      displayName: row.clientDisplayName,
    });
  }
  return [...unique.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "zh-TW"),
  );
}
