import { z } from "zod";

import type { TransportExecutionFilters } from "./types";
import {
  TRANSPORT_EXECUTION_EXCEPTION_FILTERS,
  TRANSPORT_EXECUTION_STATUSES,
} from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const candidate = new Date(`${value}T12:00:00+08:00`);
  return Number.isFinite(candidate.getTime()) && new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(candidate) === value;
});
const query = z.string().trim().max(80)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const allowed = new Set(["date", "vehicle", "driver", "status", "exception"]);

export function parseTransportExecutionFilters(
  params: URLSearchParams,
  fallbackDate: string,
): TransportExecutionFilters {
  for (const key of params.keys()) if (!allowed.has(key)) throw new Error(
    "INVALID_TRANSPORT_EXECUTION_QUERY",
  );
  for (const key of allowed) if (params.getAll(key).length > 1) throw new Error(
    "INVALID_TRANSPORT_EXECUTION_QUERY",
  );
  const serviceDate = date.safeParse(params.get("date") ?? fallbackDate);
  const vehicleQuery = query.safeParse(params.get("vehicle") ?? "");
  const driverQuery = query.safeParse(params.get("driver") ?? "");
  const completionStatus = z.enum(["all", ...TRANSPORT_EXECUTION_STATUSES])
    .safeParse(params.get("status") ?? "all");
  const exceptionStatus = z.enum(TRANSPORT_EXECUTION_EXCEPTION_FILTERS)
    .safeParse(params.get("exception") ?? "all");
  if (!serviceDate.success || !vehicleQuery.success || !driverQuery.success ||
    !completionStatus.success || !exceptionStatus.success) throw new Error(
      "INVALID_TRANSPORT_EXECUTION_QUERY",
    );
  return { serviceDate: serviceDate.data, vehicleQuery: vehicleQuery.data,
    driverQuery: driverQuery.data, completionStatus: completionStatus.data,
    exceptionStatus: exceptionStatus.data };
}
