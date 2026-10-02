// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
import { buildDemoNursingAssessmentSnapshot } from "@/lib/nursing-assessments/demo";
import { clearNursingAssessmentPendingOnLogout, getNursingAssessmentPending, type NursingAssessmentOperation } from "@/lib/nursing-assessments/pending";
import type { NursingAssessmentSnapshot, NursingReceipt } from "@/lib/nursing-assessments/types";
import { hasPendingOperations, hasViewTransition, tryAcquirePendingOperation } from "@/lib/navigation/pending-operation-lock";
import { NursingAssessmentsWorkspace } from "./nursing-assessments-workspace";

const id = (n: number) => `51930000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let sequence = 0;
let source: NursingAssessmentSnapshot;
let context: TenantContext;
const props = () => ({ context, snapshot: source, canManage: true, canSign: true, hasRecentAal2: true });
function saved(operation: NursingAssessmentOperation, at = new Date().toISOString()): NursingReceipt {
  const input = operation.input.request, signing = input.action === "sign", prior = source.clients[0]!.versions[0]!;
  return { operationId: id(40), organizationId: context.organizationId, branchId: context.branchId, actorUserId: context.userId,
    idempotencyKey: operation.input.idempotencyKey, request: structuredClone(input), replayed: false, persisted: true, demo: false,
    result: { ...structuredClone(prior), versionId: id(41), assessmentKey: signing ? prior.assessmentKey : id(42),
      version: signing ? prior.version + 1 : 1, previousVersionId: signing ? prior.versionId : null,
      previousContentHash: signing ? prior.contentHash : null, contentHash: "b".repeat(64),
      content: "content" in input ? structuredClone(input.content) : structuredClone(prior.content), recordedBy: context.userId,
      state: signing ? "signed" : "draft", signedAt: signing ? at : null, signedBy: signing ? context.userId : null,
      signerDisplayName: signing ? "合成護理員" : null, signaturePurpose: signing ? "人工護理評估簽署" : null,
      signatureChallengeId: signing ? id(43) : null, createdAt: at } };
}
function evidence(init: RequestInit, receipt: NursingReceipt | null, change: Record<string, unknown> = {}) {
  const headers = new Headers(init.headers);
  return Response.json({ requestId: id(90), status: "ok", errors: [], data: {
    schemaVersion: 1, status: receipt ? "committed" : "not_found", organizationId: context.organizationId,
    branchId: context.branchId, actorUserId: context.userId, clientId: headers.get("x-client-id"),
    action: headers.get("x-nursing-operation"), idempotencyKey: headers.get("idempotency-key"),
    nonce: headers.get("x-nursing-receipt-nonce"), verifiedAt: new Date().toISOString(),
    persisted: !!receipt, demo: false, receipt, ...change } });
}
function denial() { return Response.json({ requestId: id(90), status: "error", data: null,
  errors: [{ code: "NURSING_NOT_AUTHORIZED", message: "合成拒絕" }] }, { status: 403 }); }
async function unknown(sign = false) {
  if (sign) {
    fireEvent.click(screen.getByRole("button", { name: "簽署目前草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "確認簽署" }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "新增護理評估" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
  }
  await waitFor(() => expect(getNursingAssessmentPending().operation?.phase).toBe("unknown"));
  return getNursingAssessmentPending().operation!;
}
const checkButton = () => screen.getByRole("button", { name: "查證原紀錄（不重送）" });
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.UTC(2026, 8, 27 + ++sequence, 8)));
  clearNursingAssessmentPendingOnLogout();
  source = { ...buildDemoNursingAssessmentSnapshot(id(1), id(2)), demo: false,
    generatedAt: new Date(Date.now() - 2000).toISOString(), staleAfter: new Date(Date.now() + 298000).toISOString() };
  source.clients[0]!.versions[0]!.createdAt = new Date(Date.now() - 3000).toISOString();
  context = { organizationId: id(1), branchId: id(2), userId: source.clients[0]!.versions[0]!.recordedBy,
    organizationName: "合成機構", branchName: "合成分支", displayName: "合成護理員", roles: ["nurse"],
    scopes: ["clients.read", "nursing_assessments.read", "nursing_assessments.manage", "nursing_assessments.sign"],
    assuranceLevel: "aal2", recentAal2At: new Date(Date.now() - 10000).toISOString(), demo: false };
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => { cleanup(); clearNursingAssessmentPendingOnLogout(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("rendered exact original nursing operation receipt", () => {
  it("lost ACK → one explicit GET confirms only the original persisted record without another POST", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      return evidence(init, saved(getNursingAssessmentPending().operation!));
    });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props()} />);
    const original = await unknown(); checkButton().focus(); fireEvent.click(checkButton());
    await waitFor(() => expect(getNursingAssessmentPending().operation).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1]![0]).toBe("/api/nursing-assessments/receipt");
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(fetch.mock.calls[1]![1].body).toBeUndefined();
    expect(new Headers(fetch.mock.calls[1]![1].headers).get("idempotency-key")).toBe(original.input.idempotencyKey);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(1); expect(hasPendingOperations()).toBe(false); expect(hasViewTransition()).toBe(false);
    expect(screen.getByText(/已查證原紀錄保存成功/u)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "護理操作回查" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
    expect(screen.queryByText("護理操作已保存，清單已確認更新。")).not.toBeInTheDocument();
  });
  it("not_found retains the exact unknown body/key and private write lease", async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK"); return evidence(init, null);
    });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props()} />); const original = await unknown();
    fireEvent.click(checkButton()); await waitFor(() => expect(screen.getByText(/尚未取得原紀錄保存證明/u)).toBeInTheDocument());
    expect(getNursingAssessmentPending().operation).toBe(original); expect(getNursingAssessmentPending().operation?.body).toBe(original.body);
    expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "新增護理評估" })).toBeDisabled();
  });
  it.each(["denied", "malformed", "nonce", "wrong-original-content"] as const)("%s proof cannot clear unknown or expose old clinical contents after remount", async failure => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") throw new TypeError("synthetic lost ACK");
      if (failure === "denied") return denial();
      if (failure === "malformed") return Response.json({ private: "SYNTHETIC_CLINICAL_SECRET" });
      const receipt = saved(getNursingAssessmentPending().operation!);
      if (failure === "wrong-original-content" && "content" in receipt.request) {
        receipt.request.content.domains.observations.reason = "不是原內容";
        receipt.result.content = structuredClone(receipt.request.content);
      }
      return evidence(init, receipt, failure === "nonce" ? { nonce: id(99) } : {});
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />); const original = await unknown();
    fireEvent.click(checkButton()); await waitFor(() => expect(screen.getByText(/舊內容已隱藏/u)).toBeInTheDocument());
    view.unmount(); render(<NursingAssessmentsWorkspace {...props()} />);
    expect(screen.queryByRole("heading", { name: "合成個案甲" })).not.toBeInTheDocument(); expect(document.body).not.toHaveTextContent("SYNTHETIC_CLINICAL_SECRET");
    expect(getNursingAssessmentPending().operation?.token).toBe(original.token); expect(getNursingAssessmentPending().operation?.body).toBe(original.body);
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("expired signing recency can verify historical success but cannot sign or resend", async () => {
    let originalReceipt: NursingReceipt | null = null;
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") { originalReceipt = saved(getNursingAssessmentPending().operation!); throw new TypeError("synthetic lost ACK"); }
      return evidence(init, originalReceipt);
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />); await unknown(true);
    await act(async () => { vi.setSystemTime(Date.now() + 16 * 60000); window.dispatchEvent(new Event("online")); });
    const fresh = { ...source, generatedAt: new Date().toISOString(), staleAfter: new Date(Date.now() + 300000).toISOString() };
    view.rerender(<NursingAssessmentsWorkspace {...props()} snapshot={fresh} hasRecentAal2={false} />);
    expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeDisabled(); expect(checkButton()).toBeEnabled();
    fireEvent.click(checkButton()); await waitFor(() => expect(getNursingAssessmentPending().operation).toBeNull());
    expect(getNursingAssessmentPending().confirmed[0]?.state).toBe("signed"); expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "簽署目前草稿" })).toBeDisabled();
  });
  it("query lease blocks retries/double queries until explicit response without releasing the unknown write", async () => {
    let resolve!: (response: Response) => void, captured!: RequestInit;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      captured = init; return new Promise<Response>(finish => { resolve = finish; });
    });
    vi.stubGlobal("fetch", fetch); render(<NursingAssessmentsWorkspace {...props()} />); const original = await unknown();
    fireEvent.click(checkButton()); fireEvent.click(checkButton()); expect(fetch).toHaveBeenCalledTimes(2); expect(hasViewTransition()).toBe(true);
    expect(tryAcquirePendingOperation()).toBeNull(); expect(screen.getByRole("button", { name: "以相同內容重試" })).toBeDisabled();
    await act(async () => resolve(evidence(captured, null))); expect(hasViewTransition()).toBe(false); expect(hasPendingOperations()).toBe(true);
    expect(getNursingAssessmentPending().operation).toBe(original);
  });
  it("a late positive receipt does not steal focus from another deliberate control", async () => {
    let resolve!: (response: Response) => void, delayed!: Response;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      delayed = evidence(init, saved(getNursingAssessmentPending().operation!)); return new Promise<Response>(finish => { resolve = finish; });
    });
    vi.stubGlobal("fetch", fetch); render(<><input aria-label="其他唯讀操作" /><NursingAssessmentsWorkspace {...props()} /></>); await unknown();
    checkButton().focus(); fireEvent.click(checkButton()); screen.getByRole("textbox", { name: "其他唯讀操作" }).focus();
    await act(async () => resolve(delayed)); await waitFor(() => expect(getNursingAssessmentPending().operation).toBeNull());
    expect(screen.getByRole("textbox", { name: "其他唯讀操作" })).toHaveFocus(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["unmount", "authority-ABA", "source-replacement"] as const)("late committed proof after %s does not settle the unknown operation", async boundary => {
    let resolve!: (response: Response) => void, delayed!: Response;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      if (init.method !== "GET") return Promise.reject(new TypeError("synthetic lost ACK"));
      delayed = evidence(init, saved(getNursingAssessmentPending().operation!)); return new Promise<Response>(finish => { resolve = finish; });
    });
    vi.stubGlobal("fetch", fetch); const view = render(<NursingAssessmentsWorkspace {...props()} />); const original = await unknown(); fireEvent.click(checkButton());
    if (boundary === "unmount") view.unmount();
    else if (boundary === "authority-ABA") {
      view.rerender(<NursingAssessmentsWorkspace {...props()} context={{ ...context, scopes: [] }} />);
      view.rerender(<NursingAssessmentsWorkspace {...props()} />);
    } else view.rerender(<NursingAssessmentsWorkspace {...props()} snapshot={structuredClone(source)} />);
    await act(async () => resolve(delayed));
    expect(getNursingAssessmentPending().operation?.token).toBe(original.token); expect(getNursingAssessmentPending().operation?.phase).toBe("unknown");
    expect(getNursingAssessmentPending().confirmed).toHaveLength(0); expect(hasPendingOperations()).toBe(true); expect(hasViewTransition()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
