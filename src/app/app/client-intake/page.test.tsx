import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), directory: vi.fn(), read: vi.fn(), adminConfigured: vi.fn(), env: { AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "", AWS_KMS_KEY_ID: "" } }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context }));
vi.mock("@/lib/client-intake/server", () => ({ readIntakeSnapshot: mocks.read, loadIntakeDirectory: mocks.directory }));
vi.mock("@/components/client-intake/intake-workspace", () => ({ IntakeWorkspace: () => null }));
vi.mock("@/lib/env", () => ({ env: mocks.env, hasSupabaseAdminConfiguration: mocks.adminConfigured }));
import ClientIntakePage from "./page";
const id = "a2222222-2222-4222-8222-222222222222";
const baseContext = { organizationId: "a1111111-1111-4111-8111-111111111111", branchId: "b1111111-1111-4111-8111-111111111111", userId: "c1111111-1111-4111-8111-111111111111", roles: ["nurse", "social_worker"], demo: true, scopes: ["clients.read", "clients.demographics.read"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(baseContext);
  mocks.directory.mockResolvedValue([{ id, displayName: "合成個案", clientCode: "TEST-02" }]);
  Object.assign(mocks.env, { AWS_REGION: "ap-northeast-1", HTML_ARCHIVE_BUCKET: "", AWS_KMS_KEY_ID: "" }); mocks.adminConfigured.mockReturnValue(true);
});
it("carries a synthetic directory deep link into the same case without reading production", async () => {
  const page = await ClientIntakePage({ searchParams: Promise.resolve({ client: id, step: "documents" }) });
  expect(page.props.initialSnapshot.clientId).toBe(id);
  expect(page.props.initialStep).toBe(4);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("does not fabricate an unknown synthetic case from a query parameter", async () => {
  const page = await ClientIntakePage({ searchParams: Promise.resolve({ client: "unknown" }) });
  expect(page.props.initialSnapshot).toBeNull();
  expect(page.props.loadError).toBe(true);
});
it("reads a real profile with the authenticated context rather than demo fallback", async () => {
  const context = { ...baseContext, demo: false };
  mocks.context.mockResolvedValue(context); mocks.read.mockResolvedValue({ clientId: id });
  const page = await ClientIntakePage({ searchParams: Promise.resolve({ client: id }) });
  expect(mocks.read).toHaveBeenCalledWith(context, id);
  expect(page.props.initialSnapshot).toEqual({ clientId: id });
});
it("passes only a fail-closed archive readiness boolean, never secret configuration", async () => {
  const page = await ClientIntakePage({ searchParams: Promise.resolve({}) });
  expect(page.props.archiveConfigured).toBe(false);
  Object.assign(mocks.env, { HTML_ARCHIVE_BUCKET: "synthetic-private-bucket", AWS_KMS_KEY_ID: "synthetic-private-kms" });
  const configured = await ClientIntakePage({ searchParams: Promise.resolve({}) });
  expect(configured.props.archiveConfigured).toBe(true);
  expect(JSON.stringify(configured.props)).not.toContain("synthetic-private");
  mocks.adminConfigured.mockReturnValue(false);
  expect((await ClientIntakePage({ searchParams: Promise.resolve({}) })).props.archiveConfigured).toBe(false);
  mocks.adminConfigured.mockReturnValue(true); mocks.env.AWS_REGION = "ap-northeast-2";
  expect((await ClientIntakePage({ searchParams: Promise.resolve({}) })).props.archiveConfigured).toBe(false);
});
it("remounts private state when branch, organization, user, authorization or selected case changes", async () => {
  const page = await ClientIntakePage({ searchParams: Promise.resolve({ client: id }) });
  for (const change of [
    { branchId: "b2222222-2222-4222-8222-222222222222" },
    { organizationId: "a3333333-3333-4333-8333-333333333333" },
    { userId: "c2222222-2222-4222-8222-222222222222" },
    { roles: ["nurse"] },
    { scopes: ["clients.read", "clients.demographics.read", "clients.manage"] },
  ]) {
    mocks.context.mockResolvedValue({ ...baseContext, ...change });
    expect((await ClientIntakePage({ searchParams: Promise.resolve({ client: id }) })).key).not.toBe(page.key);
  }
  mocks.context.mockResolvedValue(baseContext);
  expect((await ClientIntakePage({ searchParams: Promise.resolve({}) })).key).not.toBe(page.key);
  mocks.context.mockResolvedValue({ ...baseContext, roles: [...baseContext.roles].reverse(), scopes: [...baseContext.scopes].reverse() });
  expect((await ClientIntakePage({ searchParams: Promise.resolve({ client: id }) })).key).toBe(page.key);
  expect(page.key).not.toContain("synthetic-private");
});
