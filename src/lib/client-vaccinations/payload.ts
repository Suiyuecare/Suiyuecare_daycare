import { z } from "zod";

import { isClientVaccinationDate } from "./date";
import type { ClientVaccinationRecordInput } from "./types";

const clean = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const uuid = z.uuid().transform((value) => value.toLowerCase());

// This narrowly scoped attestation intentionally retains database field names
// across both transports. It is returned only to the authorized mutation actor.
export const clientVaccinationPayloadSchema = z.object({
  client_id: uuid, vaccine_name: clean(160), dose_number: clean(80),
  vaccinated_on: z.string().refine(isClientVaccinationDate),
  lot_number: clean(160).nullable(), provider_name: clean(200),
  evidence_status: z.enum(["provided", "missing", "not_applicable"]),
  evidence_reference_id: uuid.nullable(),
  evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  evidence_file_name: clean(255).nullable(),
  source_system: z.enum(["manual_entry", "central_html_import", "legacy_migration"]),
  source_record_id: clean(240).nullable(),
}).strict().refine((payload) => {
  const provided = payload.evidence_status === "provided";
  return provided === (payload.evidence_reference_id !== null) &&
    provided === (payload.evidence_sha256 !== null) &&
    provided === (payload.evidence_file_name !== null) &&
    (payload.source_system === "manual_entry") === (payload.source_record_id === null);
});

export type ClientVaccinationPersistedPayload = z.output<typeof clientVaccinationPayloadSchema>;

export function clientVaccinationPayloadMatchesInput(
  payload: ClientVaccinationPersistedPayload, input: ClientVaccinationRecordInput,
) {
  if (payload.client_id !== input.clientId) return false;
  if (input.action === "void") return true; // Content is copied from the immutable previous version by SQL.
  return payload.vaccine_name === input.vaccineName && payload.dose_number === input.doseNumber &&
    payload.vaccinated_on === input.vaccinatedOn && payload.lot_number === input.lotNumber &&
    payload.provider_name === input.providerName && payload.evidence_status === input.evidenceStatus &&
    payload.evidence_reference_id === input.evidenceReferenceId && payload.evidence_sha256 === input.evidenceSha256 &&
    payload.evidence_file_name === input.evidenceFileName && payload.source_system === input.sourceSystem &&
    payload.source_record_id === input.sourceRecordId;
}
