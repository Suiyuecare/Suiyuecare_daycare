import "server-only";

import { z } from "zod";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { ASSESSMENT_MATRIX_FORMS, ASSESSMENT_MATRIX_PAGE_SIZE, canViewAssessmentMatrix } from "./config";
import type { AssessmentMatrixFilters } from "./query";
import type { AssessmentMatrixSnapshot } from "./types";

const formKeys = ["spmsq", "gds_15", "fall_risk_taipei_115", "nsi_determine", "barthel_adl", "lawton_iadl", "eat10_swallowing", "bsrs5", "mna_sf"] as const;
const cellSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z.object({ state: z.literal("draft"), versionId: z.string().uuid(), version: z.number().int().positive(), assessedOn: z.iso.date() }).strict(),
]);
const snapshotSchema = z.object({
  month: z.string().regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/u),
  generatedAt: z.iso.datetime({ offset: true }),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(25),
  totalClients: z.number().int().nonnegative(),
  forms: z.array(z.enum(formKeys)).min(1).max(9),
  clients: z.array(z.object({
    clientId: z.string().uuid(), clientCode: z.string().min(1),
    displayName: z.string().min(1), serviceStatus: z.enum(["active", "suspended"]),
    cells: z.record(z.string(), cellSchema),
  }).strict()).max(25),
}).strict();

export class AssessmentMatrixSnapshotError extends Error {
  constructor() {
    super("Assessment matrix snapshot is unavailable or invalid.");
    this.name = "AssessmentMatrixSnapshotError";
  }
}

export async function loadAssessmentMatrixSnapshot(
  context: TenantContext,
  filters: AssessmentMatrixFilters,
): Promise<AssessmentMatrixSnapshot> {
  if (!canViewAssessmentMatrix(context)) throw new AssessmentMatrixSnapshotError();
  if (context.demo) return {
    ...filters, pageSize: ASSESSMENT_MATRIX_PAGE_SIZE,
    generatedAt: new Date().toISOString(), totalClients: 0,
    forms: ASSESSMENT_MATRIX_FORMS.map((form) => form.key),
    clients: [], demo: true,
  };

  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new AssessmentMatrixSnapshotError();
  const { data, error } = await supabase.rpc("assessment_matrix_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_month: `${filters.month}-01`,
    p_page: filters.page,
    p_page_size: ASSESSMENT_MATRIX_PAGE_SIZE,
  });
  const parsed = snapshotSchema.safeParse(data);
  if (error || !parsed.success) throw new AssessmentMatrixSnapshotError();
  const snapshot = parsed.data;
  const allowedKeys = new Set(ASSESSMENT_MATRIX_FORMS.filter((form) => context.scopes.includes(form.permission)).map((form) => form.key));
  const visibleForms = new Set(snapshot.forms);
  const clientIds = new Set<string>();
  if (snapshot.month !== filters.month || snapshot.page !== filters.page ||
    snapshot.pageSize !== ASSESSMENT_MATRIX_PAGE_SIZE ||
    snapshot.forms.length !== visibleForms.size || snapshot.forms.some((key) => !allowedKeys.has(key)) ||
    snapshot.clients.length > snapshot.totalClients ||
    snapshot.clients.some((client) => {
      if (clientIds.has(client.clientId)) return true;
      clientIds.add(client.clientId);
      return Object.keys(client.cells).length !== snapshot.forms.length ||
        Object.entries(client.cells).some(([key, cell]) => !visibleForms.has(key as typeof formKeys[number]) ||
          (cell.state === "draft" && !cell.assessedOn.startsWith(`${filters.month}-`)));
    })) throw new AssessmentMatrixSnapshotError();
  return snapshot as AssessmentMatrixSnapshot;
}
