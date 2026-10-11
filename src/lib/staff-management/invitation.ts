import { z } from "zod";

const text = z.string().trim().min(1).max(100).refine((v) => !/[\u0000-\u001f\u007f]/u.test(v));
export const staffInvitationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
    displayName: text, roleId: z.uuid() }).strict(),
  z.object({ action: z.enum(["approve", "reject"]), invitationId: z.uuid() }).strict(),
]);
export const staffInvitationReceipt = z.object({ id: z.uuid(), status: z.enum(["pending", "approved", "rejected"]),
  expires_at: z.iso.datetime({ offset: true }), replayed: z.boolean() }).strict();
export const staffInvitationList = z.array(z.object({
  id: z.uuid(), allowed_email: z.email(), display_name: text, role_name: text, role_id: z.uuid(),
  status: z.enum(["pending", "approved", "rejected"]), requested_by: z.uuid(),
  requested_at: z.iso.datetime({ offset: true }), expires_at: z.iso.datetime({ offset: true }),
  decided_by: z.uuid().nullable(), decided_at: z.iso.datetime({ offset: true }).nullable(),
  activated_at: z.iso.datetime({ offset: true }).nullable(),
  state: z.enum(["pending", "approved", "rejected", "expired", "activated"]),
}).strict()).max(100);
export type StaffInvitation = z.infer<typeof staffInvitationList>[number];
