import { z } from "zod";
import { categorySchema } from "./schema";

export const DOCUMENT_HISTORY_DEFAULT_LIMIT = 50;
export const DOCUMENT_HISTORY_MAX_LIMIT = 100;
export const DOCUMENT_HISTORY_TTL_MS = 5 * 60 * 1000;
export const DOCUMENT_LIFECYCLE_RPC_TIMEOUT_MS = 10_000;

const revisionSchema = z.number().int().min(0).max(1_000_000);
const dispositionSchema = z.enum(["reviewed", "needs_replacement", "inactive"]);
export const documentHistoryQuerySchema = z.object({
  client: z.uuid(),
  category: categorySchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.string().regex(/^[1-9][0-9]{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(DOCUMENT_HISTORY_MAX_LIMIT)).optional()
    .transform((value) => value ?? DOCUMENT_HISTORY_DEFAULT_LIMIT),
}).strict();

export const documentLifecycleInputSchema = z.object({
  clientId: z.uuid(), documentId: z.uuid(), category: categorySchema,
  expectedReviewRevision: z.number().int().min(0).max(999_999),
  disposition: dispositionSchema,
  reason: z.string().trim().min(3).max(300).regex(/^[^\u0000-\u001f\u007f]*$/),
  idempotency_key: z.uuid(),
}).strict();

export const documentLifecycleReceiptSchema = z.object({
  clientId: z.uuid(), documentId: z.uuid(), category: categorySchema,
  reviewRevision: z.number().int().positive().max(1_000_000),
  disposition: dispositionSchema, persisted: z.literal(true), replayed: z.boolean(),
}).strict();

export const documentLifecycleHistoryRowSchema = z.object({
  id: z.uuid(), category: categorySchema, version: z.number().int().positive(),
  scanStatus: z.enum(["reserved", "clean", "infected", "failed"]),
  documentLabel: z.string().max(120).nullable(), provider: z.string().max(120).nullable(),
  documentDate: z.iso.date().nullable(), validUntil: z.iso.date().nullable(),
  periodFrom: z.iso.date().nullable(), periodTo: z.iso.date().nullable(),
  createdAt: z.iso.datetime({ offset: true }), reviewRevision: revisionSchema,
  disposition: z.enum(["unreviewed", "reviewed", "needs_replacement", "inactive"]),
  reviewReason: z.string().max(300).nullable(), reviewedAt: z.iso.datetime({ offset: true }).nullable(),
  canDownload: z.boolean(), canManage: z.boolean(), historicalOnly: z.boolean(),
}).strict().refine((row) => !row.canDownload || row.scanStatus === "clean");

export const documentHistoryPageSchema = z.object({
  organizationId: z.uuid(), branchId: z.uuid(), clientId: z.uuid(), category: categorySchema.nullable(),
  snapshotId: z.uuid(), generatedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  rows: z.array(documentLifecycleHistoryRowSchema).max(DOCUMENT_HISTORY_MAX_LIMIT),
  nextCursor: z.uuid().nullable(), pageSize: z.number().int().min(1).max(DOCUMENT_HISTORY_MAX_LIMIT),
}).strict().refine((page) => page.rows.length <= page.pageSize &&
  (page.nextCursor === null || page.rows.length === page.pageSize) &&
  new Set(page.rows.map((row) => row.id)).size === page.rows.length &&
  new Set(page.rows.map((row) => `${row.category}:${row.version}`)).size === page.rows.length &&
  page.rows.every((row) => page.category === null || row.category === page.category));

export type DocumentHistoryQuery = z.infer<typeof documentHistoryQuerySchema>;
export type DocumentLifecycleInput = z.infer<typeof documentLifecycleInputSchema>;
export type DocumentLifecycleReceipt = z.infer<typeof documentLifecycleReceiptSchema>;
export type DocumentLifecycleHistoryRow = z.infer<typeof documentLifecycleHistoryRowSchema>;
export type DocumentHistoryPage = z.infer<typeof documentHistoryPageSchema>;

export function validateDocumentHistoryPage(value: unknown, expected: {
  organizationId: string; branchId: string; clientId: string;
  category: DocumentHistoryPage["category"]; limit: number;
}, now = Date.now()): DocumentHistoryPage | null {
  const parsed = documentHistoryPageSchema.safeParse(value);
  if (!parsed.success) return null;
  const page = parsed.data;
  const generated = Date.parse(page.generatedAt); const expires = Date.parse(page.expiresAt);
  if (page.organizationId !== expected.organizationId || page.branchId !== expected.branchId ||
    page.clientId !== expected.clientId || page.category !== expected.category || page.pageSize !== expected.limit ||
    generated > now + 60_000 || expires <= now || expires <= generated || expires - generated > DOCUMENT_HISTORY_TTL_MS + 1000) return null;
  // The database freezes createdAt/id order and advances an opaque server-owned
  // cursor. No client-provided timestamp or offset controls an unscoped query.
  for (let index = 1; index < page.rows.length; index += 1) {
    const previous = page.rows[index - 1]; const current = page.rows[index];
    if (Date.parse(previous.createdAt) < Date.parse(current.createdAt) ||
      (previous.createdAt === current.createdAt && previous.id <= current.id)) return null;
  }
  return page;
}

export function validateDocumentLifecycleReceipt(value: unknown, input: DocumentLifecycleInput): DocumentLifecycleReceipt | null {
  const parsed = documentLifecycleReceiptSchema.safeParse(value);
  if (!parsed.success) return null;
  const receipt = parsed.data;
  return receipt.clientId === input.clientId && receipt.documentId === input.documentId &&
    receipt.category === input.category && receipt.disposition === input.disposition &&
    receipt.reviewRevision === input.expectedReviewRevision + 1 ? receipt : null;
}

export class DocumentLifecycleTimeoutError extends Error {
  constructor() { super("Document metadata request timed out"); this.name = "DocumentLifecycleTimeoutError"; }
}

export async function boundedDocumentRpc<T>(operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new DocumentLifecycleTimeoutError()); }, DOCUMENT_LIFECYCLE_RPC_TIMEOUT_MS);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
