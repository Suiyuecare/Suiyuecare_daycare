import { isStrictOffsetDateTime } from "@/lib/integrations/datetime";
import { z } from "zod";

import { BLOOD_GLUCOSE_MEAL_CONTEXTS, BLOOD_GLUCOSE_UNITS,
  type BloodGlucoseMealContext, type BloodGlucoseUnit } from "./constants";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine(
  (value) => isStrictOffsetDateTime(value) && Number.isFinite(Date.parse(value)),
).transform((value) => new Date(value).toISOString());
const baseMeasurement = {
  clientId: uuid,
  measuredAt: timestamp,
  mealContext: z.enum(BLOOD_GLUCOSE_MEAL_CONTEXTS),
  value: z.number().finite().positive(),
  unit: z.enum(BLOOD_GLUCOSE_UNITS),
  source: z.literal("staff"),
  replayed: z.boolean(),
};
const successEnvelope = z.object({
  requestId: uuid,
  status: z.literal("ok"),
  data: z.discriminatedUnion("demo", [
    z.object({
      ...baseMeasurement,
      replayed: z.literal(false),
      persisted: z.literal(false),
      demo: z.literal(true),
    }).strict(),
    z.object({
      id: uuid,
      ...baseMeasurement,
      persisted: z.literal(true),
      demo: z.literal(false),
    }).strict(),
  ]),
  errors: z.array(z.never()).length(0),
}).strict();

export class BloodGlucoseClientContractError extends Error {
  constructor() {
    super("血糖量測回覆不完整；結果未知，請保留內容並以相同操作重試。");
    this.name = "BloodGlucoseClientContractError";
  }
}

export function parseBloodGlucoseSuccess(
  raw: unknown,
  httpStatus: number,
  expected: {
    clientId: string;
    measuredAt: string;
    mealContext: BloodGlucoseMealContext;
    value: number;
    unit: BloodGlucoseUnit;
  },
) {
  const parsed = successEnvelope.safeParse(raw);
  const clientId = uuid.safeParse(expected.clientId);
  const measuredAt = timestamp.safeParse(expected.measuredAt);
  if (!parsed.success || !clientId.success || !measuredAt.success) {
    throw new BloodGlucoseClientContractError();
  }
  const data = parsed.data.data;
  const expectedHttpStatus = data.demo || data.replayed ? 200 : 201;
  if (
    httpStatus !== expectedHttpStatus ||
    data.clientId !== clientId.data ||
    data.measuredAt !== measuredAt.data ||
    data.mealContext !== expected.mealContext ||
    data.value !== expected.value ||
    data.unit !== expected.unit
  ) {
    throw new BloodGlucoseClientContractError();
  }
  return parsed.data;
}
