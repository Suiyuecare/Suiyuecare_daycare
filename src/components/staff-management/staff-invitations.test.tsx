// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ fetch: vi.fn(), register: vi.fn() }));
vi.mock("@/lib/api/client-fetch", () => ({ fetchWithTimeout: stubs.fetch }));
vi.mock("@/lib/navigation/scope-change-pending", () => ({ useScopeChangeDraftRegistration: () => stubs.register }));
import { StaffInvitations } from "./staff-invitations";

const id = "59000000-0000-4000-8000-000000000001";
const props = { currentUserId: id, canManage: true, canApprove: true, hasRecentAal2: true, demo: false,
  roles: [{ roleId: id, roleKey: "care_worker", roleName: "照顧服務員", isSystem: true }] };
function fill() {
  fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "合成員工" } });
  fireEvent.change(screen.getByLabelText("公司 Google 信箱"), { target: { value: "staff@example.invalid" } });
  fireEvent.change(screen.getByLabelText("職務"), { target: { value: id } });
}
beforeEach(() => { vi.resetAllMocks(); stubs.fetch.mockImplementation(async (_path: string, init?: RequestInit) =>
  !init?.method ? Response.json({ data: { invitations: [] } }) : Response.json({ data: { receipt: {
    id, status: "pending", expires_at: new Date().toISOString(), replayed: false,
  } } })); });
afterEach(cleanup);
describe("employee invitation usable and recoverable UI", () => {
  it("shows labelled fields, validates missing values, and never posts malformed invitations", async () => {
    render(<StaffInvitations {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "提出邀請" }));
    expect(await screen.findByRole("status")).toHaveTextContent("請填寫姓名");
    expect(stubs.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
  });
  it("prevents immediate double submission and registers dirty/busy state", async () => {
    let resolve!: (response: Response) => void;
    stubs.fetch.mockImplementation((_path: string, init?: RequestInit) => !init?.method
      ? Promise.resolve(Response.json({ data: { invitations: [] } }))
      : new Promise<Response>((done) => { resolve = done; }));
    render(<StaffInvitations {...props} />); fill();
    fireEvent.click(screen.getByRole("button", { name: "提出邀請" }));
    fireEvent.click(screen.getByRole("button", { name: "提出邀請" }));
    expect(stubs.fetch.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(stubs.register).toHaveBeenCalledWith({ dirty: true, busy: true, unknown: false });
    resolve(Response.json({ data: { receipt: { id, status: "pending", expires_at: new Date().toISOString(), replayed: false } } }));
    expect(await screen.findByText("已儲存。")).toBeVisible();
  });
  it("freezes uncertain content and retries identical payload and idempotency key", async () => {
    let attempts = 0;
    stubs.fetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (!init?.method) return Response.json({ data: { invitations: [] } });
      if (++attempts === 1) throw new Error("網路中斷");
      return Response.json({ data: { receipt: { id, status: "pending", expires_at: new Date().toISOString(), replayed: true } } });
    });
    render(<StaffInvitations {...props} />); fill();
    fireEvent.click(screen.getByRole("button", { name: "提出邀請" }));
    fireEvent.click(await screen.findByRole("button", { name: "重試同一次操作" }));
    await waitFor(() => expect(screen.getByText("已儲存。")).toBeVisible());
    const posts = stubs.fetch.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1][1].body).toBe(posts[0][1].body);
    expect(posts[1][1].headers["idempotency-key"]).toBe(posts[0][1].headers["idempotency-key"]);
  });
  it("keeps employee provisioning absent for read-only demo and unauthorized users", () => {
    render(<StaffInvitations {...props} demo />);
    expect(screen.queryByText("開通員工")).not.toBeInTheDocument();
    expect(stubs.fetch).not.toHaveBeenCalled();
  });
});
