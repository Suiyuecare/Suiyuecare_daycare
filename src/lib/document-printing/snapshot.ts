import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { buildDemoDocumentPrintingSnapshot } from "./demo";
import {
  documentAccessTokenConfigured,
  issueDocumentAccessToken,
} from "./download-token";
import {
  projectDocumentPrintingSnapshot,
  type DocumentPrintingSnapshotSourceRow,
} from "./projection";
import type { DocumentPrintingFilters } from "./types";

export class DocumentPrintingSnapshotError extends Error {
  constructor() {
    super("DOCUMENT_PRINTING_SNAPSHOT_UNAVAILABLE");
    this.name = "DocumentPrintingSnapshotError";
  }
}

export async function loadDocumentPrintingSnapshot(
  context: TenantContext,
  filters: DocumentPrintingFilters,
  allowAccessUrls: boolean,
) {
  if (context.demo) return buildDemoDocumentPrintingSnapshot({
    organizationId: context.organizationId,
    branchId: context.branchId,
    filters,
  });
  if (context.assuranceLevel !== "aal2" ||
    !context.scopes.includes("clients.read") ||
    !context.scopes.includes("document_printing.read")) {
    throw new DocumentPrintingSnapshotError();
  }
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new DocumentPrintingSnapshotError();
  const { data, error } = await supabase.rpc("document_printing_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
  }).maybeSingle<DocumentPrintingSnapshotSourceRow>();
  if (error || !data) throw new DocumentPrintingSnapshotError();
  const canIssueUrls = allowAccessUrls && documentAccessTokenConfigured() &&
    context.scopes.includes("document_printing.access");
  try {
    return projectDocumentPrintingSnapshot({
      row: data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      filters,
      demo: false,
      ...(canIssueUrls ? {
        accessUrl(jobId: string, mode: "preview" | "download") {
          const token = issueDocumentAccessToken({
            jobId,
            userId: context.userId,
            mode,
          });
          const query = new URLSearchParams({ mode, token });
          return `/api/document-print-jobs/${jobId}/pdf?${query.toString()}`;
        },
      } : {}),
    });
  } catch {
    throw new DocumentPrintingSnapshotError();
  }
}
