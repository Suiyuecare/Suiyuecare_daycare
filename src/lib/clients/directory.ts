import "server-only";

import type { TenantContext } from "@/lib/domain/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  ClientDirectoryContractError,
  parseClientDirectoryPage,
  type ClientDirectoryPage,
  type ClientDirectoryPurpose,
  type ClientDirectoryRow,
} from "./directory-contract";

const DIRECTORY_PAGE_SIZE = 200;
const MAX_DIRECTORY_ROWS = 10_000;

export type ClientDirectorySupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createServerSupabaseClient>>
>;

export class ClientDirectorySnapshotError extends Error {
  constructor() {
    super("CLIENT_DIRECTORY_SNAPSHOT_UNAVAILABLE");
    this.name = "ClientDirectorySnapshotError";
  }
}

function unavailable(): never {
  throw new ClientDirectorySnapshotError();
}

export async function loadClientDirectoryPage(
  supabase: ClientDirectorySupabaseClient,
  context: TenantContext,
  options: {
    purpose: ClientDirectoryPurpose;
    pageSize?: number;
    afterClientCode?: string | null;
    afterClientId?: string | null;
    exactClientId?: string | null;
  },
): Promise<ClientDirectoryPage> {
  const pageSize = options.pageSize ?? DIRECTORY_PAGE_SIZE;
  const result = await supabase.rpc("client_directory_snapshot", {
    p_expected_organization_id: context.organizationId,
    p_expected_branch_id: context.branchId,
    p_purpose: options.purpose,
    p_page_size: pageSize,
    p_after_client_code: options.afterClientCode ?? null,
    p_after_client_id: options.afterClientId ?? null,
    p_exact_client_id: options.exactClientId ?? null,
  });
  if (result.error) unavailable();
  try {
    return parseClientDirectoryPage({
      value: result.data,
      expectedOrganizationId: context.organizationId,
      expectedBranchId: context.branchId,
      pageSize,
    });
  } catch (error) {
    if (error instanceof ClientDirectoryContractError) unavailable();
    throw error;
  }
}

export async function loadAllClientDirectoryRows(
  supabase: ClientDirectorySupabaseClient,
  context: TenantContext,
  purpose: ClientDirectoryPurpose,
  maxRows = MAX_DIRECTORY_ROWS,
): Promise<ClientDirectoryRow[]> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > MAX_DIRECTORY_ROWS) {
    unavailable();
  }
  const rows: ClientDirectoryRow[] = [];
  const ids = new Set<string>();
  let expectedCount: number | null = null;
  let afterClientCode: string | null = null;
  let afterClientId: string | null = null;

  while (true) {
    const page = await loadClientDirectoryPage(supabase, context, {
      purpose,
      pageSize: DIRECTORY_PAGE_SIZE,
      afterClientCode,
      afterClientId,
    });
    expectedCount ??= page.visibleCount;
    if (
      page.visibleCount !== expectedCount ||
      expectedCount > maxRows ||
      (page.hasMore && page.rows.length === 0)
    ) {
      unavailable();
    }
    for (const row of page.rows) {
      if (ids.has(row.id)) unavailable();
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > expectedCount || rows.length > maxRows) unavailable();
    if (!page.hasMore) break;
    const last = page.rows.at(-1);
    if (!last) unavailable();
    afterClientCode = last.client_code;
    afterClientId = last.id;
  }

  if (rows.length !== expectedCount) unavailable();
  return rows;
}

export async function lookupClientDirectoryRow(
  supabase: ClientDirectorySupabaseClient,
  context: TenantContext,
  purpose: ClientDirectoryPurpose,
  clientId: string,
): Promise<ClientDirectoryRow | null> {
  const page = await loadClientDirectoryPage(supabase, context, {
    purpose,
    pageSize: 1,
    exactClientId: clientId,
  });
  if (
    page.hasMore ||
    page.visibleCount !== page.rows.length ||
    page.rows.length > 1 ||
    (page.rows[0] && page.rows[0].id !== clientId.toLowerCase())
  ) {
    unavailable();
  }
  return page.rows[0] ?? null;
}
