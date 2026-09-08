import "server-only";

import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface FamilyAuthorizedClient {
  clientId: string;
  clientName: string;
}

export type FamilyPortalSnapshot =
  | {
      state: "selection_required";
      authorizedClients: FamilyAuthorizedClient[];
    }
  | {
      state: "ready";
      authorizedClients: FamilyAuthorizedClient[];
      clientId: string;
      clientName: string;
      attendance: null;
      latestMeasurement: null;
      todayCompletedServices: null;
      latestCareSummary: null;
      updatedAt: null;
      publicationStatus: "not_configured";
    };

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(isStrictOffsetDateTime)
  .transform((value) => new Date(value).toISOString());
const date = z.iso.date();
const clean = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

const clientSummaryRowSchema = z.object({
  client_id: uuid,
  branch_id: uuid,
  display_name: clean(160),
  client_status: z.enum(["active", "suspended", "transferred", "closed", "deceased"]),
  admitted_on: date.nullable(),
  updated_at: timestamp,
}).strict();

const careSummaryRowSchema = z.object({
  record_id: uuid,
  category: clean(160),
  occurred_at: timestamp,
  effective_from: timestamp.nullable(),
  effective_to: timestamp.nullable(),
  signed_at: timestamp.nullable(),
  updated_at: timestamp,
}).strict();

type ClientSummaryRow = z.output<typeof clientSummaryRowSchema>;
type CareSummaryRow = z.output<typeof careSummaryRowSchema>;

function parseClientSummaryRows(value: unknown): ClientSummaryRow[] {
  const parsed = z.array(clientSummaryRowSchema).max(500).safeParse(value ?? []);
  if (!parsed.success) throw new Error("FAMILY_CLIENT_SUMMARY_INVALID");
  if (new Set(parsed.data.map((row) => row.client_id)).size !== parsed.data.length) {
    throw new Error("FAMILY_CLIENT_SUMMARY_INVALID");
  }
  return parsed.data;
}

function parseCareSummaryRows(value: unknown): CareSummaryRow[] {
  const parsed = z.array(careSummaryRowSchema).max(500).safeParse(value ?? []);
  if (!parsed.success) throw new Error("FAMILY_CARE_SUMMARY_INVALID");
  if (new Set(parsed.data.map((row) => row.record_id)).size !== parsed.data.length) {
    throw new Error("FAMILY_CARE_SUMMARY_INVALID");
  }
  return parsed.data;
}

function taipeiDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function loadFamilyPortalSnapshot(
  organizationId: string,
  branchId: string,
  selectedClientId?: string,
): Promise<FamilyPortalSnapshot | null> {
  if (isDemoMode()) return null;
  if (!uuid.safeParse(organizationId).success || !uuid.safeParse(branchId).success) {
    throw new Error("FAMILY_TENANT_CONTEXT_INVALID");
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  // This RPC is a whitelist projection backed by relationship, scope and
  // expiry checks. Never query the underlying client/health tables directly
  // from the family portal.
  const { data: clientRows, error: clientError } = await supabase.rpc(
    "family_client_summaries",
  );
  if (clientError) throw new Error("FAMILY_CLIENT_SUMMARY_READ_FAILED");

  const authorizedRows = parseClientSummaryRows(clientRows).filter(
    (row) => row.branch_id === branchId && row.client_status === "active",
  );
  const authorizedClients = authorizedRows.map((row) => ({
    clientId: row.client_id,
    clientName: row.display_name,
  }));
  if (authorizedClients.length === 0) return null;

  const selected = selectedClientId
    ? authorizedRows.find((row) => row.client_id === selectedClientId)
    : authorizedRows.length === 1
      ? authorizedRows[0]
      : null;
  if (!selected) return { state: "selection_required", authorizedClients };

  const { data: careRows, error: careError } = await supabase.rpc(
    "family_care_summaries",
    { p_client_id: selected.client_id },
  );
  if (careError) throw new Error("FAMILY_CARE_SUMMARY_READ_FAILED");

  const care = parseCareSummaryRows(careRows);
  // A legacy or widened RPC is not an institution-approved publication model.
  if (care.length > 0) throw new Error("FAMILY_PUBLICATION_NOT_CONFIGURED");

  return {
    state: "ready",
    authorizedClients,
    clientId: selected.client_id,
    clientName: selected.display_name,
    // Attendance, measurements and service counts remain closed until their
    // own consent-scoped projections are introduced.
    attendance: null,
    latestMeasurement: null,
    todayCompletedServices: null,
    latestCareSummary: null,
    updatedAt: null,
    publicationStatus: "not_configured",
  };
}

export const familySnapshotInternals = {
  parseCareSummaryRows,
  parseClientSummaryRows,
  taipeiDateKey,
};
