import type { DiaryRecord } from "@/lib/care-diary/schema";
import type { DailyWorkflowShift } from "./workflow-links";
import { taipeiServiceDateOf } from "./date";

/** A diary belongs to the selected service day in Taipei, not the browser's timezone. */
export function diaryMatchesServiceContext(
  record: Pick<DiaryRecord, "occurred_at" | "fields">,
  serviceDate: string,
  selectedShift?: DailyWorkflowShift,
) {
  return taipeiServiceDateOf(record.occurred_at) === serviceDate
    && (selectedShift === undefined || record.fields.shift === selectedShift);
}
