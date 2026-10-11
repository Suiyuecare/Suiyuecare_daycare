import { z } from "zod";

import type { QuestionnaireSelection } from "./types";

const uuid = z.string().uuid();
export function parseQuestionnaireSelection(query: Record<string, string | string[] | undefined>): QuestionnaireSelection | null {
  if (["version", "month", "new", "history_page"].some((key) => Array.isArray(query[key]))) return null;
  const versionId = typeof query.version === "string" ? query.version : null;
  const month = typeof query.month === "string" ? query.month : null;
  const newValue = query.new;
  const page = query.history_page;
  if ((versionId !== null && !uuid.safeParse(versionId).success) ||
    (month !== null && !/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/u.test(month)) ||
    (newValue !== undefined && newValue !== "1") ||
    (typeof page === "string" && (!/^[1-9]\d{0,5}$/u.test(page) || Number(page) > 100_000)) ||
    (versionId !== null && newValue === "1")) return null;
  return { versionId, month, newAssessment: newValue === "1", historyPage: typeof page === "string" ? Number(page) : 1 };
}

export function questionnaireHistoryHref(path: string, clientId: string, selection: Partial<QuestionnaireSelection> = {}) {
  const query = new URLSearchParams({ client: clientId });
  if (selection.versionId) query.set("version", selection.versionId);
  if (selection.month) query.set("month", selection.month);
  if (selection.newAssessment) query.set("new", "1");
  if (selection.historyPage && selection.historyPage > 1) query.set("history_page", String(selection.historyPage));
  return `${path}?${query}`;
}
