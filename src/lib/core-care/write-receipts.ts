import { z } from "zod";

export class CoreCareReceiptError extends Error {
  constructor() {
    super("儲存回覆不完整；結果未知。請保留內容並以相同操作重試。");
    this.name = "CoreCareReceiptError";
  }
}

const envelopeSchema = z.object({
  requestId: z.string().trim().min(1),
  status: z.literal("ok"),
  errors: z.array(z.never()).length(0),
  data: z.object({ demo: z.boolean(), persisted: z.boolean(), replayed: z.boolean() }).passthrough(),
});

function receiptData(raw: unknown, httpStatus: number, demo: boolean) {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) throw new CoreCareReceiptError();
  const data = parsed.data.data;
  if (data.demo !== demo || data.persisted !== !demo || (demo && data.replayed) ||
    httpStatus !== (demo || data.replayed ? 200 : 201)) throw new CoreCareReceiptError();
  return data;
}

// Exact input-key → persisted-kind mapping used by the dedicated measurements API.
const measurementKinds = {
  systolic: "blood_pressure_systolic", diastolic: "blood_pressure_diastolic",
  pulse: "pulse", temperature: "temperature", oxygen_saturation: "oxygen_saturation",
} as const;
type VitalValues = Partial<Record<keyof typeof measurementKinds, number>>;
const vitalReceiptSchema = z.object({ recordCount: z.number().int().positive(), measurementKinds: z.array(z.string()).min(1) });

export function parseVitalWriteReceipt(raw: unknown, httpStatus: number, demo: boolean, values: VitalValues) {
  const parsed = vitalReceiptSchema.safeParse(receiptData(raw, httpStatus, demo));
  if (!parsed.success) throw new CoreCareReceiptError();
  const expected = (Object.keys(measurementKinds) as Array<keyof typeof measurementKinds>)
    .filter((key) => values[key] != null).map((key) => measurementKinds[key]).sort();
  const actual = [...parsed.data.measurementKinds].sort();
  if (!expected.length || parsed.data.recordCount !== expected.length || actual.length !== expected.length ||
    actual.some((kind, index) => kind !== expected[index])) throw new CoreCareReceiptError();
  return parsed.data;
}

const diaryReceiptSchema = z.object({
  record: z.object({ id: z.string().trim().min(1), version: z.number().int().positive(), status: z.literal("draft") }),
  page: z.object({ slug: z.literal("staff/daily-care/care-diary") }),
});

export function parseDiaryWriteReceipt(raw: unknown, httpStatus: number, demo: boolean) {
  const parsed = diaryReceiptSchema.safeParse(receiptData(raw, httpStatus, demo));
  if (!parsed.success) throw new CoreCareReceiptError();
  return parsed.data;
}
