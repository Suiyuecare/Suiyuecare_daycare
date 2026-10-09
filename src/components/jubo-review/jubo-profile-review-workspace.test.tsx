// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hasPendingOperations, tryAcquireViewTransition } from "@/lib/navigation/pending-operation-lock";

import { JuboProfileReviewWorkspace } from "./jubo-profile-review-workspace";

const controls = vi.hoisted(() => ({ releases: [] as Array<() => void> }));
vi.mock("@/lib/navigation/pending-operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/navigation/pending-operation-lock")>();
  return { ...actual, tryAcquirePendingOperation: () => {
    const release = actual.tryAcquirePendingOperation();
    if (release) controls.releases.push(release);
    return release;
  } };
});

const pairId = "a1000000-0000-4000-8000-000000000001";
const rowId = "a2000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const rows = Array.from({ length: 23 }, (_, offset) => ({
  sourceRowId: offset === 0 ? rowId : `a2000000-0000-4000-8000-${String(offset + 1).padStart(12, "0")}`,
  sourceSheetRow: offset + 6, reviewVersion: 0, decision: "unreviewed",
}));
const queue = { reviewPurpose: "jubo_intake_profile_mapping_v2", eligiblePairCount: 1,
  pairs: [{ pairId, verifiedAt: "2026-10-09T06:00:00.000Z", sourceRows: rows }] };
const originalMappedValues = {
  displayName: { index: 2, value: "合成個案甲" }, sex: { index: 3, value: "女" },
  dateOfBirth: { index: 23, value: "040/01/01" }, identityNumber: { index: 25, value: "SYN-ID-0001" },
  registeredAddress: { index: 32, value: "合成戶籍地" }, residentialAddress: { index: 35, value: "合成居住地" },
  cmsLevel: { index: 48, value: "第3級" }, disability: { index: 54, value: null },
  primaryContactName: { index: 78, value: "合成家屬" }, primaryContactPhone: { index: 79, value: "０９１２－３４５６７８" },
  proxyName: { index: 80, value: null }, proxyPhone: { index: 81, value: null },
};
const preview = {
  reviewPurpose: "jubo_intake_profile_mapping_v2", mappingVersion: "jubo-master-monthly-202610-v2",
  pairId, sourceRowId: rowId, sourceSheetRow: 6, sourceRowSha256: hash,
  mappingReviewSha256: "b".repeat(64), monthlySourceRowId: null,
  originalMappedValues,
  displayProfile: { displayName: "合成個案甲", sex: "female", dateOfBirth: "1951-01-01",
    identityNumber: "SYNID0001", phone: null, registeredAddress: "合成戶籍地", residentialAddress: "合成居住地",
    cmsLevel: 3, disability: null, contacts: [{ name: "合成家屬", relationship: "", phone: "0912345678",
      address: "", isPrimary: true, isEmergency: false }], consent: { status: "pending", confirmedOn: null }, notes: "" },
  normalizationFieldIndices: { nfkc: [79], contactSeparator: [79] }, normalizationRequiresConfirmation: true,
  previewId: "a3000000-0000-4000-8000-000000000001", previewSha256: "c".repeat(64),
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};
const receipt = { reviewId: "a4000000-0000-4000-8000-000000000001", reviewVersion: 1,
  decision: "approved", replayed: false };

function response(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => ({ status: status < 400 ? "ok" : "error",
    data: status < 400 ? data : null, errors: status < 400 ? [] : [{ code: "JUBO_REVIEW_CONFLICT", message: "版本已變更" }] }) };
}

let requests: Array<{ url: string; options: RequestInit }>;
beforeEach(() => {
  requests = [];
  vi.stubGlobal("crypto", { randomUUID: () => "a5000000-0000-4000-8000-000000000001" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/queue")) return response(queue);
    if (url.endsWith("/preview")) return response(preview);
    if (url.endsWith("/receipt")) return response({ status: "found", receipt: { ...receipt, replayed: true } });
    return response(receipt);
  }));
});
afterEach(() => { cleanup(); for (const release of controls.releases.splice(0)) release(); vi.unstubAllGlobals(); });

it("shows only 23 source ordinals before a row is explicitly previewed", async () => {
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2 />);
  expect(await screen.findByRole("button", { name: /第 6 列/ })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /第 \d+ 列/ })).toHaveLength(23);
  expect(screen.queryByText("合成個案甲")).not.toBeInTheDocument();
  expect(screen.queryByText("SYN-ID-0001")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /第 6 列/ }));
  expect(await screen.findByText("SYN-ID-0001")).toBeInTheDocument();
  expect(screen.getByText("SYNID0001")).toBeInTheDocument();
  expect(screen.getByText("０９１２－３４５６７８")).toBeInTheDocument();
  expect(screen.getByText("0912345678")).toBeInTheDocument();
  expect(screen.getByText("有文字轉換，請特別確認標示欄位。")).toBeInTheDocument();
  expect(requests[1]?.options.cache).toBe("no-store");
  expect(JSON.stringify(requests[1]?.options.body)).not.toContain("SYN-ID-0001");
});

it("requires explicit field acknowledgment and reason; sends source-bound hashes, not PII", async () => {
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2 />);
  fireEvent.click(await screen.findByRole("button", { name: /第 6 列/ }));
  await screen.findByText("SYN-ID-0001");
  const submit = screen.getByRole("button", { name: "記錄：暫緩" });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "已核准" }));
  fireEvent.change(screen.getByRole("textbox", { name: /覆核理由/ }),
    { target: { value: "合成資料已逐欄核對原值及顯示值" } });
  expect(screen.getByRole("button", { name: "記錄：已核准" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核對此列原值/ }));
  fireEvent.click(screen.getByRole("button", { name: "記錄：已核准" }));
  expect(hasPendingOperations()).toBe(true);
  await waitFor(() => expect(requests.some((request) => request.url.endsWith("/decision"))).toBe(true));
  await waitFor(() => expect(hasPendingOperations()).toBe(false));
  const sent = JSON.parse(String(requests.find((request) => request.url.endsWith("/decision"))?.options.body));
  expect(sent).toMatchObject({ pairId, sourceRowId: rowId, previewId: preview.previewId,
    sourceRowSha256: hash, mappingReviewSha256: "b".repeat(64), previewSha256: "c".repeat(64),
    decision: "approved", idempotencyKey: "a5000000-0000-4000-8000-000000000001" });
  expect(JSON.stringify(sent)).not.toContain("SYN-ID-0001");
  expect(JSON.stringify(sent)).not.toContain("合成個案甲");
  expect(requests.every((request) => !request.url.includes("SYN-ID") && request.options.cache === "no-store")).toBe(true);
}, 20_000);

it("never loads private rows before AAL2; a status check still asks the guarded API", async () => {
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2={false} />);
  expect(screen.getByText("請先完成近期驗證")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "前往驗證" })).toHaveAttribute("href", "/mfa?audience=staff&purpose=sensitive-action");
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "核對狀態" }));
  await waitFor(() => expect(requests).toHaveLength(1));
});

it("holds branch/logout/reload during uncertainty and checks only the exact original receipt", async () => {
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/queue")) return response(queue);
    if (url.endsWith("/preview")) return response(preview);
    if (url.endsWith("/receipt")) return response({ status: "found", receipt: { ...receipt, decision: "held", replayed: true } });
    writes += 1;
    throw new Error("network timeout");
  }));
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2 />);
  fireEvent.click(await screen.findByRole("button", { name: /第 6 列/ }));
  await screen.findByText("SYN-ID-0001");
  fireEvent.change(screen.getByRole("textbox", { name: /覆核理由/ }),
    { target: { value: "合成來源逐欄確認後請先暫緩入庫" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核對此列原值/ }));
  fireEvent.click(screen.getByRole("button", { name: "記錄：暫緩" }));
  await screen.findByRole("alert");
  expect(hasPendingOperations()).toBe(true);
  expect(tryAcquireViewTransition()).toBeNull();
  const beforeUnload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);
  expect(requests.filter((entry) => entry.url.endsWith("/decision"))).toHaveLength(1);
  expect(screen.getByRole("button", { name: "核對狀態" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "核對狀態" }));
  await waitFor(() => expect(requests.filter((entry) => entry.url.endsWith("/queue"))).toHaveLength(2));
  expect(requests.filter((entry) => entry.url.endsWith("/decision"))).toHaveLength(1);
  expect(await screen.findByText("尚未確認原送出結果。請以原操作核對，暫勿建立新一次覆核。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /第 6 列/ })).toBeDisabled();
  expect(hasPendingOperations()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "查原操作回執" }));
  await waitFor(() => expect(hasPendingOperations()).toBe(false));
  const decisions = requests.filter((entry) => entry.url.endsWith("/decision"));
  const lookups = requests.filter((entry) => entry.url.endsWith("/receipt"));
  expect(decisions).toHaveLength(1);
  expect(lookups).toHaveLength(1);
  expect(decisions[0]?.options.body).toBe(lookups[0]?.options.body);
  expect(writes).toBe(1);
});

it("uses read-only receipt recovery after preview and AAL2 expire, without another write", async () => {
  const shortPreview = { ...preview, expiresAt: new Date(Date.now() + 300).toISOString() };
  let queueReads = 0;
  let receipts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/queue")) {
      queueReads += 1;
      return queueReads === 1 ? response(queue) : { ok: false, status: 403,
        json: async () => ({ status: "error", data: null,
          errors: [{ code: "JUBO_REAUTH_REQUIRED", message: "重新驗證已逾時" }] }) };
    }
    if (url.endsWith("/preview")) return response(shortPreview);
    if (url.endsWith("/receipt")) {
      receipts += 1;
      return response(receipts === 1 ? { status: "unconfirmed", receipt: null }
        : { status: "found", receipt: { ...receipt, decision: "held", replayed: true } });
    }
    throw new Error("network timeout");
  }));
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2 />);
  fireEvent.click(await screen.findByRole("button", { name: /第 6 列/ }));
  await screen.findByText("SYN-ID-0001");
  fireEvent.change(screen.getByRole("textbox", { name: /覆核理由/ }),
    { target: { value: "合成來源逐欄確認後請先暫緩入庫" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核對此列原值/ }));
  fireEvent.click(screen.getByRole("button", { name: "記錄：暫緩" }));
  await screen.findByRole("alert");
  expect(hasPendingOperations()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核對狀態" }));
  await waitFor(() => expect(queueReads).toBe(2));
  expect(screen.getByText(/重新驗證已逾時/)).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(Date.parse(shortPreview.expiresAt)).toBeLessThanOrEqual(Date.now());
  fireEvent.click(screen.getByRole("button", { name: "查原操作回執" }));
  await waitFor(() => expect(receipts).toBe(1));
  expect(hasPendingOperations()).toBe(true);
  expect(screen.getByText(/原請求仍可能在處理/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查原操作回執" }));
  await waitFor(() => expect(hasPendingOperations()).toBe(false));
  expect(requests.filter((entry) => entry.url.endsWith("/decision"))).toHaveLength(1);
  const lookups = requests.filter((entry) => entry.url.endsWith("/receipt"));
  expect(lookups).toHaveLength(2);
  expect(lookups[0]?.options.body).toBe(lookups[1]?.options.body);
  expect(lookups[0]?.options.body).toBe(requests.find((entry) => entry.url.endsWith("/decision"))?.options.body);
  expect(screen.getByText(/已查到原操作回執/)).toBeInTheDocument();
}, 20_000);

it("releases the tab-wide lease when the server proves an uncommitted AAL2 rejection", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/queue")) return response(queue);
    if (url.endsWith("/preview")) return response(preview);
    return { ok: false, status: 403, json: async () => ({ status: "error", data: null,
      errors: [{ code: "JUBO_REAUTH_REQUIRED", message: "重新驗證已逾時" }] }) };
  }));
  render(<JuboProfileReviewWorkspace branchName="合成分支" recentAal2 />);
  fireEvent.click(await screen.findByRole("button", { name: /第 6 列/ }));
  await screen.findByText("SYN-ID-0001");
  fireEvent.change(screen.getByRole("textbox", { name: /覆核理由/ }),
    { target: { value: "合成來源逐欄確認後暫緩處理" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /我已核對此列原值/ }));
  fireEvent.click(screen.getByRole("button", { name: "記錄：暫緩" }));
  await waitFor(() => expect(hasPendingOperations()).toBe(false));
  expect(screen.getByText(/未建立本次覆核/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查原操作回執" })).not.toBeInTheDocument();
});
