import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { parseToccDraftRows } from "@/lib/integrations/client-tocc-drafts";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class ToccDraftSnapshotError extends Error {
  constructor() {
    super("TOCC_DRAFT_SNAPSHOT_UNAVAILABLE");
    this.name = "ToccDraftSnapshotError";
  }
}

const DRAFT_PAGE_SIZE = 100;

export async function loadToccDraftSnapshot(actor: TenantContext, page = 0) {
  if (actor.demo || !actor.branchId) return { drafts: [], hasMore: false };
  if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) throw new ToccDraftSnapshotError();
  const db = await createServerSupabaseClient();
  if (!db) throw new ToccDraftSnapshotError();
  const { data, error } = await db.rpc("client_tocc_draft_snapshot", {
    p_expected_organization_id: actor.organizationId,
    p_expected_branch_id: actor.branchId,
    p_limit: DRAFT_PAGE_SIZE + 1,
    p_offset: page * DRAFT_PAGE_SIZE,
  });
  if (error) throw new ToccDraftSnapshotError();
  try {
    const rows = parseToccDraftRows(data ?? []);
    return { drafts: rows.slice(0, DRAFT_PAGE_SIZE), hasMore: rows.length > DRAFT_PAGE_SIZE };
  } catch {
    throw new ToccDraftSnapshotError();
  }
}
