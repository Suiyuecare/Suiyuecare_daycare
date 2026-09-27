// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/domain/types";
let journal: typeof import("./upload-pending");
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context: TenantContext = { organizationId: uuid(1), organizationName: "Synthetic", branchId: uuid(2), branchName: "Synthetic",
  userId: uuid(3), displayName: "Synthetic", roles: ["case_manager_social_worker"],
  scopes: ["imports.manage", "clients.read", "clients.demographics.read", "clients.manage", "clients.view_all"], assuranceLevel: "aal1", recentAal2At: null, demo: false };
const file = { name: "synthetic.html", size: 10, mime: "text/html", sha256: "a".repeat(64) };
beforeEach(async () => { vi.resetModules(); journal = await import("./upload-pending"); journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)); });
afterEach(() => journal.clearCmsUploadOnLogout());
const scope = () => journal.cmsUploadScope(context, "routine-intake", uuid(4));
const begin = () => journal.beginCmsUpload(scope(), file, uuid(5), uuid(6))!;
describe("tab-local original CMS upload journal", () => {
  it("freezes original key and metadata only, excluding File bytes or browser storage", () => {
    const local = vi.spyOn(Storage.prototype, "setItem"); const operation = begin();
    expect(Object.isFrozen(operation)).toBe(true); expect(Object.isFrozen(operation.file)).toBe(true);
    expect(operation.file).toEqual(file); expect(operation).not.toHaveProperty("bytes"); expect(operation).not.toHaveProperty("html");
    journal.markCmsUploadUnknown(operation, scope()); const kept = journal.getCmsUploadOperation(scope())!;
    expect(kept.key).toBe(operation.key); expect(kept.originalId).toBe(operation.originalId); expect(kept.file).toEqual(file); expect(local).not.toHaveBeenCalled(); local.mockRestore();
  });
  it("synchronous duplicate start and foreign client cannot create replacement", () => {
    const operation = begin(); expect(begin()).toBeNull();
    expect(journal.getCmsUploadOperation(journal.cmsUploadScope(context, "routine-intake", uuid(9)))).toBeNull();
    expect(journal.hasCmsUploadOperation()).toBe(true); expect(operation.phase).toBe("sending");
  });
  it("unknown keeps navigation guard and forbids releasing without correlated staged preview", () => {
    const operation = begin(); journal.markCmsUploadUnknown(operation, scope()); const unknown = journal.getCmsUploadOperation(scope())!;
    expect(journal.finishCmsUpload(unknown, scope())).toBe(false);
    const link = document.createElement("a"); link.href = "/other"; document.body.append(link);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true }); expect(link.dispatchEvent(event)).toBe(false); link.remove();
  });
  it("authority ABA invalidates old read/completion and permits explicit current-authority recovery", () => {
    const original = begin(); journal.markCmsUploadUnknown(original, scope()); const read = journal.beginCmsUploadRead(scope(), original.token)!;
    const changed = { ...context, recentAal2At: "2026-09-28T00:00:00Z" };
    journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)); journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context));
    expect(read.signal.aborted).toBe(true); expect(read.current()).toBe(false); expect(journal.isCurrentCmsUpload(original, scope())).toBe(false);
    const retry = journal.retryCmsUpload(scope(), original.token, uuid(7))!;
    expect(retry.key).toBe(original.key); expect(retry.file).toEqual(file); expect(retry.scope.authority).toBe(scope().authority);
    expect(journal.isCurrentCmsUpload(retry, scope())).toBe(true); read.close();
  });
  it("an absent authority fences reads before identical server props return", () => {
    const original = begin(); journal.markCmsUploadUnknown(original, scope());
    const read = journal.beginCmsUploadRead(scope(), original.token)!;
    const epoch = journal.getCmsUploadState().epoch;
    journal.observeCmsUploadAuthority(null);
    expect(journal.getCmsUploadState().epoch).toBe(epoch + 1);
    expect(journal.canUseCmsUpload(scope())).toBe(false);
    expect(read.signal.aborted).toBe(true); expect(read.current()).toBe(false);
    journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context));
    expect(journal.getCmsUploadState().epoch).toBe(epoch + 2);
    expect(journal.isCurrentCmsUpload(original, scope())).toBe(false);
    expect(journal.hasCmsUploadOperation()).toBe(true);
    read.close();
  });
  it.each(["branchId", "userId", "scopes"] as const)("current %s changes hide source and reject old owner", field => {
    const original = begin(); const changed = { ...context, [field]: field === "scopes" ? [] : uuid(9) };
    journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(changed)); expect(journal.getCmsUploadOperation(scope())).toBeNull();
    expect(journal.isCurrentCmsUpload(original, scope())).toBe(false); expect(journal.hasCmsUploadOperation()).toBe(true);
  });
  it("logout hides all pending data, cancels reads, releases guards and disables old identity", () => {
    const original = begin(); journal.markCmsUploadUnknown(original, scope()); const read = journal.beginCmsUploadRead(scope(), original.token)!;
    journal.clearCmsUploadOnLogout(); expect(read.signal.aborted).toBe(true); expect(read.current()).toBe(false);
    expect(journal.hasCmsUploadOperation()).toBe(false); expect(journal.getCmsUploadOperation(scope())).toBeNull();
    journal.observeCmsUploadAuthority(journal.cmsUploadAuthority(context)); expect(journal.canUseCmsUpload(scope())).toBe(false); read.close();
  });
});
