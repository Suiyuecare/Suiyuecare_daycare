import "server-only";

import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { familyWorkspaceSchema, type FamilyWorkspaceSnapshot } from "./workspace-schema";

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
      publicationStatus: "not_configured" | "configured";
      workspace?: FamilyWorkspaceSnapshot;
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

  const { data: workspaceRow, error: workspaceError } = await supabase.rpc("family_workspace", { p_org: organizationId, p_branch: branchId, p_client: selected.client_id }).maybeSingle<{ payload: unknown }>();
  if (workspaceError) throw new Error("FAMILY_WORKSPACE_READ_FAILED");
  const workspace = familyWorkspaceSchema.parse(workspaceRow?.payload);
  if (workspace.clientId !== selected.client_id) throw new Error("FAMILY_CLIENT_SCOPE_MISMATCH");

  return {
    state: "ready",
    authorizedClients,
    clientId: selected.client_id,
    clientName: selected.display_name,
    // Legacy direct-data fields remain null. The workspace contains only
    // separately consented, staff-approved disclosures, not inferred counts.
    attendance: null,
    latestMeasurement: null,
    todayCompletedServices: null,
    latestCareSummary: null,
    updatedAt: null,
    publicationStatus: "configured",
    workspace,
  };
}

export const familySnapshotInternals = {
  parseCareSummaryRows,
  parseClientSummaryRows,
  taipeiDateKey,
};
