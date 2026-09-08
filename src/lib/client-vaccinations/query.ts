import { z } from "zod";

import { isClientVaccinationDate } from "./date";
import { CLIENT_VACCINATION_STATUS_FILTERS,
  type ClientVaccinationFilters, type ClientVaccinationStatusFilter } from "./types";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const clean = (maximum: number) => z.string().trim().max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? null : value;
}

export function parseClientVaccinationFilters(
  query: Record<string, string | string[] | undefined>,
): { filters: ClientVaccinationFilters; invalid: boolean } {
  let invalid = Object.values(query).some(Array.isArray);
  const rawClient = one(query.client) ?? "";
  const rawVaccine = one(query.vaccine) ?? "";
  const rawDose = one(query.dose) ?? "";
  const rawFrom = one(query.from) ?? "";
  const rawTo = one(query.to) ?? "";
  const rawStatus = one(query.status) ?? "all";
  const rawQuery = one(query.q) ?? "";
  const client = rawClient && rawClient !== "all" ? uuid.safeParse(rawClient) : null;
  const vaccine = rawVaccine && rawVaccine !== "all" ? clean(160).safeParse(rawVaccine) : null;
  const dose = rawDose && rawDose !== "all" ? clean(80).safeParse(rawDose) : null;
  const search = clean(120).safeParse(rawQuery);
  if ((client && !client.success) || (vaccine && (!vaccine.success || !vaccine.data)) ||
    (dose && (!dose.success || !dose.data)) || !search.success ||
    (rawFrom && !isClientVaccinationDate(rawFrom)) ||
    (rawTo && !isClientVaccinationDate(rawTo)) ||
    !CLIENT_VACCINATION_STATUS_FILTERS.includes(rawStatus as ClientVaccinationStatusFilter) ||
    (rawFrom && rawTo && rawFrom > rawTo)) invalid = true;
  return {
    filters: {
      clientId: client?.success ? client.data : null,
      vaccineName: vaccine?.success ? vaccine.data : null,
      doseNumber: dose?.success ? dose.data : null,
      dateFrom: isClientVaccinationDate(rawFrom) ? rawFrom : null,
      dateTo: isClientVaccinationDate(rawTo) ? rawTo : null,
      status: CLIENT_VACCINATION_STATUS_FILTERS.includes(
        rawStatus as ClientVaccinationStatusFilter,
      ) ? rawStatus as ClientVaccinationStatusFilter : "all",
      query: search.success ? search.data : "",
    },
    invalid,
  };
}
