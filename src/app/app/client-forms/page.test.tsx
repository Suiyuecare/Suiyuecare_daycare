import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), directory: vi.fn(), routine: vi.fn(), recent: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth/context", () => ({ requireTenantContext: mocks.context, hasRecentAal2: mocks.recent }));
vi.mock("@/lib/auth/routine-care", () => ({ canUseRoutineCare: mocks.routine }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.db }));
vi.mock("@/lib/clients/directory", () => ({ loadAllClientDirectoryRows: mocks.directory }));
vi.mock("@/components/form-responses/form-responses-workspace", () => ({ FormResponsesWorkspace: () => null }));
import ClientFormsPage from "./page";
import { demoFormClient } from "@/lib/custom-form-responses/demo";
const id = "a2222222-2222-4222-8222-222222222222";
const context = { organizationId: "a1111111-1111-4111-8111-111111111111", branchId: "b1111111-1111-4111-8111-111111111111", userId: "c1111111-1111-4111-8111-111111111111", roles: ["nurse", "care_worker"], demo: false, scopes: ["care_records.read", "care_records.write", "care_records.sign"] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.context.mockResolvedValue(context); mocks.routine.mockResolvedValue(true); mocks.recent.mockResolvedValue(false);
  mocks.db.mockResolvedValue({}); mocks.directory.mockResolvedValue([{ id, client_code: "TEST-02", display_name: "合成個案" }]);
});
it("retains exact selected client and only passes minimum directory fields", async () => {
  const page = await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) });
  expect(page.props.initialClient).toBe(id); expect(page.props.canSign).toBe(false);
  expect(page.props.clients).toEqual([{ id, label: "TEST-02・合成個案" }]); expect(page.props.demoSnapshot).toBeUndefined();
});
it("does not fallback to another client for an inaccessible deep link", async () => {
  const page = await ClientFormsPage({ searchParams: Promise.resolve({ client: context.userId }) });
  expect(page.props.role).toBe("alert"); expect(page.props.clients).toBeUndefined();
});
it.each([{ client: [id, id] }, { client: "invalid" }, { branch: context.branchId }])("rejects malformed or scope-injecting query", async (query) => {
  const page = await ClientFormsPage({ searchParams: Promise.resolve(query) });
  expect(page.props.role).toBe("alert"); expect(mocks.directory).not.toHaveBeenCalled();
});
it("fails closed without read authority or complete directory", async () => {
  mocks.routine.mockResolvedValue(false);
  expect((await ClientFormsPage({ searchParams: Promise.resolve({}) })).props.role).toBe("alert");
  expect(mocks.directory).not.toHaveBeenCalled(); mocks.routine.mockResolvedValue(true); mocks.directory.mockRejectedValue(new Error("unavailable"));
  expect((await ClientFormsPage({ searchParams: Promise.resolve({}) })).props.role).toBe("alert");
});
it("uses synthetic read-only preview only in explicit demo mode, without database calls", async () => {
  mocks.context.mockResolvedValue({ ...context, demo: true });
  const page = await ClientFormsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.initialClient).toBe(demoFormClient.id); expect(page.props.demoSnapshot.forms).toHaveLength(1); expect(page.props.canSign).toBe(false);
  expect(mocks.directory).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
});
it("resets private component state on branch, actor or authorization change", async () => {
  const first = await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) });
  for (const change of [{ branchId: id }, { userId: id }, { roles: ["care_worker"] }, { scopes: ["care_records.read"] }]) {
    mocks.context.mockResolvedValue({ ...context, ...change });
    expect((await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) })).key).not.toBe(first.key);
  }
  mocks.context.mockResolvedValue({ ...context, roles: [...context.roles].reverse(), scopes: [...context.scopes].reverse() });
  expect((await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) })).key).toBe(first.key);
});
it("only enables print with every document permission and recent verification", async () => {
  const scopes = [...context.scopes, "document_printing.read", "document_printing.manage", "document_printing.access"];
  mocks.context.mockResolvedValue({ ...context, scopes });
  expect((await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) })).props.canPrint).toBe(false);
  mocks.recent.mockResolvedValue(true);
  const page = await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) });
  expect(page.props.canPrint).toBe(true); expect(page.props.printActor).toEqual({ actorId: context.userId, organizationId: context.organizationId, branchId: context.branchId });
  for (const permission of ["care_records.read", "document_printing.read", "document_printing.manage", "document_printing.access"]) {
    mocks.context.mockResolvedValue({ ...context, scopes: scopes.filter((scope) => scope !== permission) });
    expect((await ClientFormsPage({ searchParams: Promise.resolve({ client: id }) })).props.canPrint).toBe(false);
  }
});
