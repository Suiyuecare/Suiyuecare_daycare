import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const result = z.object({
  client_id: uuid,
  display_name: z.string().min(1).max(120),
  client_code: z.string().max(64),
  client_code_truncated: z.boolean(),
}).strict();
const source = z.object({
  organization_id: uuid,
  branch_id: uuid,
  clients: z.array(result).max(20),
  has_more: z.boolean(),
}).strict();

export type AbcdClientSearchResult = {
  organizationId: string;
  branchId: string;
  clients: readonly {
    clientId: string;
    displayName: string;
    clientCode: string;
    clientCodeTruncated: boolean;
  }[];
  hasMore: boolean;
};

export function parseAbcdClientSearchQuery(value: unknown): string {
  const body = z.object({ query: z.string() }).strict().safeParse(value);
  const query = body.success ? body.data.query.trim() : "";
  if ([...query].length < 2 || [...query].length > 64 || /\p{Cc}/u.test(query)) {
    throw new IntegrationError("INVALID_ABCD_CLIENT_SEARCH", "請輸入 2 至 64 字的姓名或個案代碼。", 400);
  }
  return query;
}

export function parseAbcdClientSearchResult(value: unknown,
  organizationId: string, branchId: string): AbcdClientSearchResult {
  const parsed = source.safeParse(value);
  if (!parsed.success || parsed.data.organization_id !== organizationId ||
    parsed.data.branch_id !== branchId ||
    new Set(parsed.data.clients.map((client) => client.client_id)).size !== parsed.data.clients.length) {
    throw new IntegrationError("ABCD_CLIENT_SEARCH_INVALID_RESPONSE",
      "個案搜尋結果無法確認，請重新搜尋。", 502);
  }
  return {
    organizationId, branchId, hasMore: parsed.data.has_more,
    clients: parsed.data.clients.map((client) => ({
      clientId: client.client_id, displayName: client.display_name,
      clientCode: client.client_code, clientCodeTruncated: client.client_code_truncated,
    })),
  };
}
