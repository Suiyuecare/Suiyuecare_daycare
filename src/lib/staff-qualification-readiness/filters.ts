import { z } from "zod";
import { IntegrationError } from "@/lib/integrations/errors";
import { QUALIFICATION_ISSUES, type QualificationFilters } from "./model";

const schema = z.object({
  issue: z.enum(["all", ...QUALIFICATION_ISSUES]).default("all"),
  staff: z.union([z.uuid(), z.literal("all"), z.literal("")]).optional(),
  q: z.string().max(120).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)).default(""),
}).strict();

export function parseQualificationFilters(query: Record<string, unknown>): QualificationFilters {
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new IntegrationError("INVALID_QUALIFICATION_FILTERS", "請檢查待辦分類與員工篩選，或清除篩選後重試。", 400);
  return { issue: parsed.data.issue,
    staff: parsed.data.staff && parsed.data.staff !== "all" ? parsed.data.staff.toLowerCase() : null,
    query: parsed.data.q.trim() };
}
