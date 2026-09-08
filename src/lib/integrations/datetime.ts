import { z } from "zod";

import { IntegrationError } from "./errors";

const offsetDateTime = z.iso.datetime({ offset: true });
const minuteOffsetDateTime = z.iso.datetime({ offset: true, precision: -1 });

/** Validate the calendar before Date.parse can silently normalize February 30. */
export function isStrictOffsetDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const canonical = value.replace("t", "T").replace(/z$/u, "Z");
  return (offsetDateTime.safeParse(canonical).success || minuteOffsetDateTime.safeParse(canonical).success) &&
    Number.isFinite(Date.parse(canonical));
}

export function parseIsoDateTime(
  value: unknown,
  field: string,
  options: { min?: Date; max?: Date } = {},
) {
  if (!isStrictOffsetDateTime(value)) {
    throw new IntegrationError(
      "INVALID_DATETIME", "日期時間必須是有效曆日的 ISO 格式並包含時區。", 400, field,
    );
  }
  const parsed = new Date(value);
  if (options.min && parsed < options.min) {
    throw new IntegrationError(
      "DATETIME_TOO_OLD", "日期時間已超過允許範圍。", 400, field,
    );
  }
  if (options.max && parsed > options.max) {
    throw new IntegrationError(
      "DATETIME_IN_FUTURE", "日期時間超出允許的未來範圍。", 400, field,
    );
  }
  return parsed.toISOString();
}
