import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import { MEAL_CONFLICT_FILTERS, MEAL_KINDS, type MealManagementFilters } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});

function one(parameters: URLSearchParams, key: string) {
  const values = parameters.getAll(key);
  if (values.length > 1) throw new IntegrationError(
    "INVALID_MEAL_FILTER", "餐食篩選條件不得重複。", 400, key,
  );
  return values[0] ?? null;
}

export function parseMealManagementFilters(
  parameters: URLSearchParams,
  fallbackServiceDate: string,
): MealManagementFilters {
  const allowed = new Set(["date", "meal", "texture", "conflict"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key))) {
    throw new IntegrationError("INVALID_MEAL_FILTER", "餐食篩選包含未知欄位。", 400);
  }
  const serviceDate = one(parameters, "date") || fallbackServiceDate;
  const mealKind = one(parameters, "meal") || "all";
  const textureQuery = (one(parameters, "texture") || "").trim();
  const conflict = one(parameters, "conflict") || "all";
  if (!date.safeParse(serviceDate).success ||
    !(mealKind === "all" || MEAL_KINDS.includes(mealKind as never)) ||
    !MEAL_CONFLICT_FILTERS.includes(conflict as never) || textureQuery.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(textureQuery)) {
    throw new IntegrationError("INVALID_MEAL_FILTER", "餐食日期或篩選值無效。", 400);
  }
  return { serviceDate, mealKind: mealKind as MealManagementFilters["mealKind"],
    textureQuery, conflict: conflict as MealManagementFilters["conflict"] };
}
