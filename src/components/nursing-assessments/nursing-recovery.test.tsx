// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending } from "@/lib/nursing-assessments/pending";
import { nursingReadAuthoritySignature } from "@/lib/nursing-assessments/read-authority";
import type { NursingAssessmentSnapshot } from "@/lib/nursing-assessments/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";
import { NursingAssessmentsWorkspace } from "./nursing-assessments-workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const org = "51000000-0000-4000-8000-000000000001";
const other = "51000000-0000-4000-8000-000000000099";
let sequence = 0;
let context: TenantContext;
let source: NursingAssessmentSnapshot;
const props = () => ({ context, snapshot: source, canManage: true, canSign: true, hasRecentAal2: true });
function projection(offset = 0) {
  const at = new Date(Date.now() + offset).toISOString();
  return { ...structuredClone(source), generatedAt: at, staleAfter: new Date(Date.parse(at) + 300_000).toISOString() };
}
function readResponse(init: RequestInit, snapshot = projection(), change: Record<string, unknown> = {}) {
  return Response.json({ requestId: other, status: "ok", errors: [], data: {
    schemaVersion: 1, organizationId: org, branchId: org, actorUserId: context.userId,
    nonce: new Headers(init.headers).get("x-nursing-read-nonce"), snapshot,
    capabilities: { canManage: true, canSign: true, hasRecentAal2: true },
    authoritySignature: nursingReadAuthoritySignature(context), demo: false, ...change,
  } });
}
function denial() {
  return Response.json({ requestId: other, status: "error", data: null,
    errors: [{ code: "NURSING_NOT_AUTHORIZED", message: "合成拒絕" }] }, { status: 403 });
}
function sign() {
  fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "確認簽署" }));
}
const recoveryButton = () => screen.getByRole("button", { name: "更新授權資料（不重送）" });
const pendingBody = () => getNursingAssessmentPending().operation?.body;

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => {
  clearNursingAssessmentPendingOnLogout();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Logout floors intentionally survive between mounts. Each synthetic session
  // is newer, rather than resetting the production journal's privacy watermark.
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 8, sequence++ * 10)));
  source = { ...buildDemoNursingAssessmentSnapshot(org, org), demo: false };
  source.generatedAt = new Date(Date.now() - 2000).toISOString();
  source.staleAfter = new Date(Date.parse(source.generatedAt) + 300_000).toISOString();
  source.clients[0]!.versions[0]!.createdAt = new Date(Date.now() - 3000).toISOString();
  context = { organizationId: org, branchId: org, userId: source.clients[0]!.versions[0]!.recordedBy,
    organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理人員",
    roles: ["nurse"], scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: new Date(Date.now() - 10_000).toISOString(), demo: false };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => {
  cleanup(); clearNursingAssessmentPendingOnLogout(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("independent rendered nursing manual recovery", () => {
  it("lost acknowledgement → load failure → one actual nonce-bound GET → explicit original-key retry", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method === "GET") return readResponse(init);
      if (fetch.mock.calls.filter(call => call[1].method !== "GET").length === 1) throw new TypeError("synthetic lost ACK");
      return denial();
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    const original = getNursingAssessmentPending().operation!;
    view.rerender(<NursingAssessmentsWorkspace {...props()} snapshot={null} loadError />);
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1]![0]).toBe("/api/nursing-assessments/snapshot");
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(fetch.mock.calls[1]![1].body).toBeUndefined(); expect(getNursingAssessmentPending().operation?.token).toBe(original.token);
    expect(pendingBody()).toBe(original.body); expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "以相同內容重試" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2]![1].body).toBe(fetch.mock.calls[0]![1].body);
    expect(new Headers(fetch.mock.calls[2]![1].headers).get("idempotency-key")).toBe(original.input.idempotencyKey);
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["denied", "malformed", "signature", "nonce"] as const)("%s GET quarantines old props across remount without releasing the unknown write", async kind => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      if (kind === "denied") return denial();
      if (kind === "malformed") return Response.json({ status: "ok", data: "CLINICAL_SECRET" });
      if (kind === "nonce") return readResponse(init, projection(), { nonce: other });
      return readResponse(init, projection(), { authoritySignature: nursingReadAuthoritySignature({ ...context, roles: [...context.roles, "branch_director"] }) });
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    const original = getNursingAssessmentPending().operation!;
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByText(/舊內容已隱藏/u)).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    view.unmount(); render(<NursingAssessmentsWorkspace {...props()} />);
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    expect(pendingBody()).toBe(original.body); expect(hasPendingOperations()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2); expect(refresh).not.toHaveBeenCalled(); expect(document.body).not.toHaveTextContent("CLINICAL_SECRET");
  });

  it("pending GET owns the view lease, excludes double-clicks and unrelated writes, and retains its own unknown lease", async () => {
    let resolve!: (value: Response) => void;
    let readInit!: RequestInit;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      readInit = init; return new Promise<Response>(complete => { resolve = complete; });
    });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    const original = getNursingAssessmentPending().operation!;
    fireEvent.click(recoveryButton()); fireEvent.click(recoveryButton());
    expect(fetch).toHaveBeenCalledTimes(2); expect(hasViewTransition()).toBe(true); expect(hasPendingOperations()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); expect(tryAcquireViewTransition()).toBeNull();
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeDisabled();
    await act(async () => resolve(readResponse(readInit)));
    await waitFor(() => expect(hasViewTransition()).toBe(false));
    expect(getNursingAssessmentPending().operation?.token).toBe(original.token); expect(hasPendingOperations()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2); expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["unmount", "actor", "scope_revoke", "logout"] as const)("late GET after %s cannot reveal a projection or release another scope's operation", async boundary => {
    let resolve!: (value: Response) => void;
    let delayed!: Response;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      delayed = readResponse(init); return new Promise<Response>(complete => { resolve = complete; });
    });
    vi.stubGlobal("fetch", fetch);
    const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    fireEvent.click(recoveryButton()); expect(hasViewTransition()).toBe(true);
    if (boundary === "unmount") view.unmount();
    else if (boundary === "logout") act(() => clearNursingAssessmentPendingOnLogout());
    else {
      const changed = boundary === "actor" ? { ...context, userId: other } : { ...context, scopes: context.scopes.filter(scope => scope !== "nursing_assessments.read") };
      view.rerender(<NursingAssessmentsWorkspace {...props()} context={changed} />);
      view.rerender(<NursingAssessmentsWorkspace {...props()} />);
    }
    await act(async () => resolve(delayed));
    if (boundary === "unmount") render(<NursingAssessmentsWorkspace {...props()} />);
    await waitFor(() => expect(hasViewTransition()).toBe(false));
    if (boundary !== "unmount") expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2); expect(refresh).not.toHaveBeenCalled();
    if (boundary !== "logout") expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
  });

  it("network failure does not invent authority or enable retry after source expiry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("synthetic offline")));
    render(<NursingAssessmentsWorkspace {...props()} />); sign();
    await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    await act(async () => {
      vi.setSystemTime(new Date(Date.now() + 301_000));
      window.dispatchEvent(new Event("online"));
    });
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByText(/目前連線未完成/u)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"); expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled();
  });

  it("StrictMode settles admission without a subscription/layout loop and never initiates a read on mount", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<StrictMode><NursingAssessmentsWorkspace {...props()} /></StrictMode>);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled(); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
  });

  it("newer GET assignment loss hides original content; only a newer independent read may restore explicit retry", async () => {
    let generation = 0;
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      const snapshot = projection();
      if (generation++ === 0) { snapshot.clients = [snapshot.clients[1]!]; snapshot.clientTotal = 1; }
      return readResponse(init, snapshot);
    });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    const original = getNursingAssessmentPending().operation!;
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument());
    expect(screen.queryByText(original.target!.content.domains.observations.detail!)).not.toBeInTheDocument();
    expect(pendingBody()).toBe(original.body); expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(Date.now() + 1000)); fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled());
    expect(fetch).toHaveBeenCalledTimes(3); expect(getNursingAssessmentPending().operation?.token).toBe(original.token);
    expect(pendingBody()).toBe(original.body); expect(hasPendingOperations()).toBe(true); expect(refresh).not.toHaveBeenCalled();
  });

  it("same-generation visibility loss is quarantined and cannot be healed by replaying the original supplied props", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      return readResponse(init, { ...structuredClone(source), clients: [source.clients[1]!], clientTotal: 1 });
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByRole("region", { name: "護理操作回查" })).toHaveTextContent("內容已隱藏"));
    expect(screen.getByText(/未能取得授權的最新資料，舊內容已隱藏/u)).toBeInTheDocument();
    view.rerender(<NursingAssessmentsWorkspace {...props()} />);
    expect(getNursingAssessmentPending().snapshotFloor).toBe(source.generatedAt);
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2); expect(hasPendingOperations()).toBe(true);
  });

  it("a retained GET override cannot mask same-generation assignment revocation delivered through new server props", async () => {
    const recovered = projection();
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      return readResponse(init, recovered);
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    fireEvent.click(recoveryButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeEnabled());
    view.rerender(<NursingAssessmentsWorkspace {...props()} snapshot={{ ...recovered, clients: [recovered.clients[1]!], clientTotal: 1 }} />);
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "以相同內容重試" })).not.toBeInTheDocument();
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(2); expect(hasPendingOperations()).toBe(true);
  });

  it("a delayed read bound to superseded server props cannot advance the current source watermark", async () => {
    let resolve!: (value: Response) => void;
    let readInit!: RequestInit;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      readInit = init; return new Promise<Response>(complete => { resolve = complete; });
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />);
    sign(); await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
    fireEvent.click(recoveryButton());
    const currentServer = projection();
    view.rerender(<NursingAssessmentsWorkspace {...props()} snapshot={currentServer} />);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument();
    vi.setSystemTime(new Date(Date.now() + 1000));
    await act(async () => resolve(readResponse(readInit, projection())));
    expect(getNursingAssessmentPending().acceptedSnapshotAt).toBe(currentServer.generatedAt);
    expect(screen.getByRole("heading", { name: "合成個案甲" })).toBeInTheDocument();
    expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(2); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
  });
});
