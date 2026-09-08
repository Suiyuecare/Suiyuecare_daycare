import { z } from "zod";

import { IntegrationError } from "@/lib/integrations/errors";

import {
  TRANSPORT_DIRECTIONS,
  TRANSPORT_PLAN_STATUS_FILTERS,
  type TransportPlanFilters,
} from "./types";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const instant = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(instant.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant) === value;
});

function one(parameters: URLSearchParams, key: string) {
  const values = parameters.getAll(key);
  if (values.length > 1) throw new IntegrationError(
    "INVALID_TRANSPORT_PLAN_FILTER", "交通計畫篩選條件不得重複。", 400, key,
  );
  return values[0] ?? null;
}

export function parseTransportPlanFilters(
  parameters: URLSearchParams,
  fallbackDate: string,
): TransportPlanFilters {
  const allowed = new Set(["date", "direction", "vehicle", "driver", "status"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key))) throw new IntegrationError(
    "INVALID_TRANSPORT_PLAN_FILTER", "交通計畫篩選包含未知欄位。", 400,
  );
  const serviceDate = one(parameters, "date") || fallbackDate;
  const direction = one(parameters, "direction") || "all";
  const vehicleQuery = (one(parameters, "vehicle") || "").trim();
  const driverQuery = (one(parameters, "driver") || "").trim();
  const status = one(parameters, "status") || "all";
  const cleanText = (value: string) => value.length <= 80 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  if (!calendarDate.safeParse(serviceDate).success ||
    !(direction === "all" || TRANSPORT_DIRECTIONS.includes(direction as never)) ||
    !TRANSPORT_PLAN_STATUS_FILTERS.includes(status as never) ||
    !cleanText(vehicleQuery) || !cleanText(driverQuery)) {
    throw new IntegrationError(
      "INVALID_TRANSPORT_PLAN_FILTER", "交通計畫日期或篩選值無效。", 400,
    );
  }
  return { serviceDate, direction: direction as TransportPlanFilters["direction"],
    vehicleQuery, driverQuery, status: status as TransportPlanFilters["status"] };
}
