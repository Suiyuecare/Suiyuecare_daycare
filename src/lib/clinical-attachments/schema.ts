import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "@/lib/client-documents/schema";

export const CLINICAL_ATTACHMENT_BUCKET = "clinical-attachments";
export const clinicalSourceKind = z.enum(["care_diary", "body_assessment", "vaccination", "inspection", "family_message"]);
export type ClinicalSourceKind = z.infer<typeof clinicalSourceKind>;
export const clinicalSourceSchema = z.object({ clientId: z.uuid(), sourceKind: clinicalSourceKind, sourceId: z.uuid(), sourceVersion: z.number().int().positive().max(1_000_001) }).strict();
export type ClinicalSource = z.infer<typeof clinicalSourceSchema>;
export const clinicalUploadSchema = clinicalSourceSchema.extend({ label: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]*$/), idempotency_key: z.uuid() });
export const clinicalReservationSchema = clinicalSourceSchema.extend({ id: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), objectPath: z.string(), replayed: z.boolean(), scanStatus: z.enum(["clean", "infected", "failed"]).nullable() });
export const clinicalReceiptSchema = clinicalSourceSchema.extend({ id: z.uuid(), scanStatus: z.enum(["clean", "infected", "failed"]), persisted: z.literal(true) });
export const clinicalSnapshotSchema = clinicalSourceSchema.extend({ canUpload: z.boolean(), rows: z.array(z.object({ id: z.uuid(), label: z.string().min(1).max(120), mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]), fileSizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES), scanStatus: z.enum(["reserved", "clean", "infected", "failed"]), createdAt: z.iso.datetime({ offset: true }), canDownload: z.boolean() }).refine(row => row.canDownload === (row.scanStatus === "clean"))).max(100) });
export type ClinicalAttachmentsSnapshot = z.infer<typeof clinicalSnapshotSchema>;
