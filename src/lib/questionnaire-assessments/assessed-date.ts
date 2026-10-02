import { z } from "zod";

export function questionnaireTaipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// A date-only assessment field is neither a UTC instant nor a save timestamp.
export const questionnaireAssessedDateSchema = z.iso.date().refine(
  (value) => value >= "2000-01-01" && value <= questionnaireTaipeiToday(),
);
