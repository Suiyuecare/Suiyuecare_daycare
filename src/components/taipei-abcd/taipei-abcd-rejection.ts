/** Only a complete, trusted API error envelope can release a first-attempt key. */
export function isDefinitiveRejection(
  status: number,
  body: unknown,
  knownCodes: Readonly<Record<number, readonly string[]>>,
) {
  if (!body || typeof body !== "object") return false;
  const envelope = body as Record<string, unknown>;
  const envelopeKeys = Object.keys(envelope).sort();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const safeText = (value: unknown, max: number) => typeof value === "string" &&
    value.length > 0 && value.length <= max && value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  if (envelope.status !== "error" || envelope.data !== null ||
      envelopeKeys.join(",") !== "data,errors,requestId,status" ||
      typeof envelope.requestId !== "string" || !uuid.test(envelope.requestId) ||
      !Array.isArray(envelope.errors) || envelope.errors.length !== 1) return false;
  const error: unknown = envelope.errors[0];
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const detail = error as Record<string, unknown>;
  const keys = Object.keys(detail).sort().join(",");
  return (keys === "code,message" || keys === "code,field,message") &&
    safeText(detail.message, 500) &&
    (detail.field === undefined || safeText(detail.field, 120)) &&
    typeof detail.code === "string" && Boolean(knownCodes[status]?.includes(detail.code));
}
