import { projectStaffAnnouncementSnapshot } from "./projection";

const generatedAt = "2026-09-01T10:30:00+08:00";
const firstRelease = "68111111-1111-4111-8111-111111111112";
const scheduledRelease = "68222222-2222-4222-8222-222222222222";
const withdrawnRelease = "68333333-3333-4333-8333-333333333332";

const recipients = {
  [firstRelease]: [
    ["68a11111-1111-4111-8111-111111111111", "王社工", "SW-001", "direct", null],
    ["68a22222-2222-4222-8222-222222222222", "李護理師", "NU-002", "role", "2026-09-01T09:20:00+08:00"],
    ["68a33333-3333-4333-8333-333333333333", "陳照服員", "CW-003", "direct_and_role", null],
  ],
  [scheduledRelease]: [
    ["68a11111-1111-4111-8111-111111111111", "王社工", "SW-001", "role", null],
    ["68a22222-2222-4222-8222-222222222222", "李護理師", "NU-002", "role", null],
  ],
  [withdrawnRelease]: [
    ["68a22222-2222-4222-8222-222222222222", "李護理師", "NU-002", "direct", "2026-08-31T08:20:00+08:00"],
    ["68a33333-3333-4333-8333-333333333333", "陳照服員", "CW-003", "role", null],
  ],
} as const;

export function buildDemoStaffAnnouncementSnapshot(input: {
  organizationId: string;
  branchId: string;
  selectedReleaseId: string | null;
}) {
  const detail = input.selectedReleaseId && input.selectedReleaseId in recipients
    ? recipients[input.selectedReleaseId as keyof typeof recipients]
    : [];
  return projectStaffAnnouncementSnapshot({
    expectedOrganizationId: input.organizationId,
    expectedBranchId: input.branchId,
    expectedCanManage: true,
    generatedAtFallback: generatedAt,
    demo: true,
    selectedReleaseId: detail.length ? input.selectedReleaseId : null,
    recipientRows: detail.map(([id, name, code, resolution, readAt]) => ({
      recipient_user_id: id,
      recipient_display_name: name,
      recipient_employee_code: code,
      recipient_profile_kind: code.startsWith("NU") ? "professional" : "staff",
      resolution_kind: resolution,
      read_at: readAt,
    })),
    audienceRow: {
      generated_at: generatedAt,
      staff_options: [
        { user_id: "68a11111-1111-4111-8111-111111111111", display_name: "王社工", employee_code: "SW-001", profile_kind: "staff" },
        { user_id: "68a22222-2222-4222-8222-222222222222", display_name: "李護理師", employee_code: "NU-002", profile_kind: "professional" },
        { user_id: "68a33333-3333-4333-8333-333333333333", display_name: "陳照服員", employee_code: "CW-003", profile_kind: "staff" },
      ],
      role_options: [
        { role_id: "68b11111-1111-4111-8111-111111111111", role_name: "護理人員" },
        { role_id: "68b22222-2222-4222-8222-222222222222", role_name: "照顧服務員" },
      ],
    },
    rows: [
      {
        generated_at: generatedAt,
        version_id: "68111111-1111-4111-8111-111111111113",
        announcement_key: "68111111-1111-4111-8111-111111111110",
        version: 3,
        version_state: "draft",
        title: "九月家訪交接（未發布草稿）",
        body: "草稿新增了交接表單提醒；目前發布版本尚未包含這段內容。",
        publish_at: "2026-09-02T08:00:00+08:00",
        expires_at: null,
        lifecycle: "published",
        has_pending_draft: true,
        audience_user_ids: ["68a11111-1111-4111-8111-111111111111"],
        audience_role_ids: ["68b22222-2222-4222-8222-222222222222"],
        active_release_version_id: firstRelease,
        active_release_version: 2,
        active_release_title: "九月家訪交接",
        active_release_body: "請依目前發布版完成家訪交接。",
        active_release_publish_at: "2026-09-01T08:00:00+08:00",
        active_release_expires_at: null,
        recipient_count: 3,
        read_count: 1,
        unread_count: 2,
        actor_is_recipient: true,
        actor_read_at: null,
        withdrawal_reason: null,
        can_manage: true,
      },
      {
        generated_at: generatedAt,
        version_id: scheduledRelease,
        announcement_key: "68222222-2222-4222-8222-222222222220",
        version: 2,
        version_state: "release",
        title: "中秋排班提醒",
        body: "此公告已建立員工收件快照，將於指定時間在員工入口顯示。",
        publish_at: "2026-09-02T09:00:00+08:00",
        expires_at: "2026-09-20T18:00:00+08:00",
        lifecycle: "scheduled",
        has_pending_draft: false,
        audience_user_ids: [],
        audience_role_ids: ["68b11111-1111-4111-8111-111111111111"],
        active_release_version_id: scheduledRelease,
        active_release_version: 2,
        active_release_title: "中秋排班提醒",
        active_release_body: "此公告已建立員工收件快照，將於指定時間在員工入口顯示。",
        active_release_publish_at: "2026-09-02T09:00:00+08:00",
        active_release_expires_at: "2026-09-20T18:00:00+08:00",
        recipient_count: 2,
        read_count: 0,
        unread_count: 2,
        actor_is_recipient: false,
        actor_read_at: null,
        withdrawal_reason: null,
        can_manage: true,
      },
      {
        generated_at: generatedAt,
        version_id: "68333333-3333-4333-8333-333333333333",
        announcement_key: "68333333-3333-4333-8333-333333333330",
        version: 3,
        version_state: "withdrawal",
        title: "舊版訪客動線",
        body: "此合成公告已撤回。",
        publish_at: "2026-08-31T08:00:00+08:00",
        expires_at: null,
        lifecycle: "withdrawn",
        has_pending_draft: false,
        audience_user_ids: ["68a22222-2222-4222-8222-222222222222"],
        audience_role_ids: ["68b22222-2222-4222-8222-222222222222"],
        active_release_version_id: withdrawnRelease,
        active_release_version: 2,
        active_release_title: "舊版訪客動線",
        active_release_body: "請依舊版動線引導訪客。",
        active_release_publish_at: "2026-08-31T08:00:00+08:00",
        active_release_expires_at: null,
        recipient_count: 2,
        read_count: 1,
        unread_count: 1,
        actor_is_recipient: true,
        actor_read_at: "2026-08-31T08:20:00+08:00",
        withdrawal_reason: "動線已更新，避免同仁沿用舊版。",
        can_manage: true,
      },
    ],
  });
}
