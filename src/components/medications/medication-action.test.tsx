// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDemoMedicationAdministrationSnapshot } from "@/lib/medications/demo";
import type { TenantContext } from "@/lib/domain/types";
let { clearMedicationPendingOnLogout, getMedicationPending, medicationAuthoritySignature, observeMedicationAuthority } = await import("@/lib/medications/pending");

let { MedicationAction, taipeiLocalToIso } = await import("./medication-action");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const serviceDate = "2026-09-01";
const context: TenantContext = { organizationId: "f1111111-1111-4111-8111-111111111110", organizationName: "測試機構",
  branchId: "f1111111-1111-4111-8111-111111111112", branchName: "測試分支", userId: "f1111111-1111-4111-8111-111111111111",
  displayName: "護理人員", roles: ["nurse"], scopes: ["medications.administer", "medications.verify"], assuranceLevel: "aal2", recentAal2At: null, demo: false };
const snapshot = buildDemoMedicationAdministrationSnapshot(serviceDate);
const scheduled = snapshot.rows.find(
  (row) => row.finalizationState === "scheduled",
)!;

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterEach(() => {
  cleanup();
  clearMedicationPendingOnLogout();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
beforeEach(async () => {
  vi.resetModules();
  ({ clearMedicationPendingOnLogout, getMedicationPending, medicationAuthoritySignature, observeMedicationAuthority } = await import("@/lib/medications/pending"));
  ({ MedicationAction, taipeiLocalToIso } = await import("./medication-action"));
  observeMedicationAuthority(medicationAuthoritySignature(context));
});

function element(demo = false, canRecord = true, actor = context, instance: "desktop" | "mobile" = "desktop") {
  return <MedicationAction context={actor} snapshotGeneratedAt={snapshot.generatedAt} canRecord={canRecord} canVerify currentUserId={actor.userId}
    demo={demo} hasRecentAal2 instance={instance} row={scheduled} serviceDate={serviceDate} />;
}
function renderScheduled(demo = false) {
  return render(
    <MedicationAction
      context={context}
      snapshotGeneratedAt={snapshot.generatedAt}
      canRecord
      canVerify
      currentUserId="f1111111-1111-4111-8111-111111111111"
      demo={demo}
      hasRecentAal2
      instance="desktop"
      row={scheduled}
      serviceDate={serviceDate}
    />,
  );
}
function openAndSign() {
  fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }));
  fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));
}
function successFor(body: string) {
  return Response.json({ requestId: "11111111-1111-4111-8111-111111111111", status: "ok", errors: [], data: {
    operationId: "22222222-2222-4222-8222-222222222222", medicationAdministrationId: scheduled.id,
    status: "administered", occurredAt: JSON.parse(body).occurred_at, requiresSecondVerification: false,
    finalizationState: "signed", signedAt: JSON.parse(body).occurred_at, replayed: false, persisted: true, demo: false,
  } }, { status: 201 });
}

describe("medication action browser boundary", () => {
  it("round-trips Taipei local time and rejects normalized impossible dates", () => {
    expect(taipeiLocalToIso("2026-02-28T08:30")).toBe(
      "2026-02-28T00:30:00.000Z",
    );
    expect(() => taipeiLocalToIso("2026-02-31T08:30")).toThrow(
      "INVALID_LOCAL_DATETIME",
    );
  });

  it("keeps demo signing visibly read-only", () => {
    renderScheduled(true);
    const button = screen.getByRole("button", {
      name: /記錄並簽署：展示模式只讀/u,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("keeps the dialog open when a 2xx receipt belongs to another slot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { occurred_at: string };
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId:
                "33333333-3333-4333-8333-333333333333",
              status: "administered",
              occurredAt: body.occurred_at,
              requiresSecondVerification: false,
              finalizationState: "signed",
              signedAt: body.occurred_at,
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /回覆不完整.*11111111-1111-4111-8111-111111111111/u,
      );
    });
    expect(
      screen
        .getByRole("dialog", { name: "記錄並簽署用藥結果" })
        .hasAttribute("open"),
    ).toBe(true);
  });

  it("closes a confirmed success and restores focus to its trigger", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { occurred_at: string };
        return new Response(
          JSON.stringify({
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "ok",
            data: {
              operationId: "22222222-2222-4222-8222-222222222222",
              medicationAdministrationId: scheduled.id,
              status: "administered",
              occurredAt: body.occurred_at,
              requiresSecondVerification: false,
              finalizationState: "signed",
              signedAt: body.occurred_at,
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    renderScheduled();
    const trigger = screen.getByRole("button", { name: "記錄並簽署" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "記錄並簽署用藥結果",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );

    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(screen.getByRole("status"));
    expect(screen.getByRole("status").textContent).toMatch(/完成簽署/u);
  });

  it("prevents Escape cancellation while the signature request is pending", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
      ),
    );
    renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "確認執行並簽署" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "簽署中…" })).toBeTruthy(),
    );
    const dialog = screen.getByRole("dialog", {
      name: "記錄並簽署用藥結果",
    });
    const cancel = new Event("cancel", { cancelable: true });
    expect(dialog.dispatchEvent(cancel)).toBe(false);
    expect(dialog.hasAttribute("open")).toBe(true);
    resolveResponse?.(
      new Response(
        JSON.stringify({ status: "error", data: null, errors: [] }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("locks fields and confirmation before POST, suppresses double submit and exact retries after uncertainty", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher); renderScheduled(); openAndSign();
    const operation = getMedicationPending().operation!;
    const status = screen.getByRole("combobox", { name: "執行狀態 *" }) as HTMLSelectElement;
    const date = screen.getByLabelText("實際發生日期與時間 *") as HTMLInputElement;
    const confirmation = screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }) as HTMLInputElement;
    expect(status.disabled).toBe(true); expect(date.disabled).toBe(true); expect(confirmation.disabled).toBe(true);
    fireEvent.change(status, { target: { value: "refused" } }); fireEvent.change(date, { target: { value: "2026-09-01T09:00" } });
    fireEvent.submit(screen.getByRole("dialog", { name: "記錄並簽署用藥結果" }).querySelector("form")!);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(getMedicationPending().operation).toBe(operation);
    await act(async () => { resolve(Response.json({ status: "error" }, { status: 409 })); });
    expect(screen.getByRole("button", { name: "重試原用藥操作" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "返回清單（保留原操作）" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(getMedicationPending().operation?.key).toBe(operation.key);
    fireEvent.click(screen.getByRole("button", { name: "檢視原用藥操作" }));
    fireEvent.click(screen.getByRole("button", { name: "重試原用藥操作" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const first = fetcher.mock.calls[0]![1] as RequestInit, second = fetcher.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body); expect(second.headers).toEqual(first.headers); expect(getMedicationPending().operation?.key).toBe(operation.key);
  });

  it("remounts unknown original input without automatic POST and manually reuses its key/body", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    const view = renderScheduled(); fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "refused" } });
    fireEvent.change(screen.getByRole("textbox", { name: "拒絕服用原因 *" }), { target: { value: "本人拒絕，已通知護理人員。" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u }));
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));
    await screen.findByRole("alert"); const original = getMedicationPending().operation!;
    view.unmount(); renderScheduled(); expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "檢視原用藥操作" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("refused");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("本人拒絕，已通知護理人員。");
    fireEvent.click(screen.getByRole("button", { name: "重試原用藥操作" })); await screen.findByRole("alert");
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[1]![1].body).toBe(original.body);
    expect(fetcher.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(original.key);
  });

  it("unmount invalidates its in-flight callback while preserving manual recovery", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const view = renderScheduled(); openAndSign(); const original = getMedicationPending().operation!;
    view.unmount(); renderScheduled(); expect(getMedicationPending().operation?.phase).toBe("unknown");
    await act(async () => { resolve(successFor(original.body)); });
    expect(getMedicationPending().saved).toHaveLength(0); expect(getMedicationPending().operation?.key).toBe(original.key); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("caps a hanging JSON decoder without an automatic retry or a changed intent", async () => {
    vi.useFakeTimers(); const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => new Promise(() => {}) }); vi.stubGlobal("fetch", fetcher);
    renderScheduled(); openAndSign(); const original = getMedicationPending().operation!;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(getMedicationPending().operation?.phase).toBe("unknown"); expect(getMedicationPending().operation?.key).toBe(original.key);
    expect(screen.getByRole("button", { name: "重試原用藥操作" })).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("desktop and mobile actions share one operation and duplicate submit cannot POST again", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    render(<>{element(false, true, context, "desktop")}{element(false, true, context, "mobile")}</>);
    fireEvent.click(screen.getAllByRole("button", { name: "記錄並簽署" })[0]!);
    fireEvent.click(screen.getByRole("checkbox", { name: /我確認以上執行結果正確/u })); fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" }));
    await screen.findByRole("alert"); const original = getMedicationPending().operation!;
    expect(getMedicationPending().operation?.key).toBe(original.key); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("source/capability ABA and late response keep original intent quarantined", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const view = render(element()); openAndSign(); const original = getMedicationPending().operation!;
    view.rerender(element(false, false)); view.rerender(element());
    await act(async () => { resolve(successFor(original.body)); });
    expect(getMedicationPending().operation?.quarantined).toBe(true); expect(getMedicationPending().saved).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("status").textContent).toMatch(/安全登出/u); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("logout cannot be undone by stale observers or a late successful response", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    renderScheduled(); openAndSign(); const original = getMedicationPending().operation!;
    await act(async () => { clearMedicationPendingOnLogout(); observeMedicationAuthority(medicationAuthoritySignature(context)); resolve(successFor(original.body)); });
    expect(getMedicationPending().authority).toBeNull(); expect(getMedicationPending().operation).toBeNull(); expect(getMedicationPending().saved).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("owns missing-confirmation validation and prevents IME submission", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); renderScheduled(); fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" })); expect(fetcher).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("checkbox")); expect(screen.getByRole("checkbox").getAttribute("aria-invalid")).toBe("true");
    const form = screen.getByRole("dialog", { name: "記錄並簽署用藥結果" }).querySelector("form")!; expect(form.noValidate).toBe(true);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.compositionStart(form); fireEvent.submit(form); expect(fetcher).not.toHaveBeenCalled();
  });
  it("warns before discarding unsubmitted input and continuing keeps it intact", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); renderScheduled(); fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "refused" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "保留填寫" } });
    fireEvent.click(screen.getAllByRole("button", { name: "取消" })[0]!);
    expect(screen.getByRole("dialog", { name: "離開未保存的用藥填寫？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "繼續填寫" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("保留填寫"); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "取消" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "捨棄填寫並繼續" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" })); expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("administered");
  });
  it("new server snapshot generation invalidates a pending attempt even for an unchanged row", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
    const view = renderScheduled(); openAndSign(); const original = getMedicationPending().operation!;
    view.rerender(<MedicationAction context={context} snapshotGeneratedAt="2026-09-01T00:31:00.000Z" canRecord canVerify
      currentUserId={context.userId} demo={false} hasRecentAal2 instance="desktop" row={scheduled} serviceDate={serviceDate} />);
    await act(async () => { resolve(successFor(original.body)); });
    expect(getMedicationPending().operation?.quarantined).toBe(true); expect(getMedicationPending().saved).toHaveLength(0); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts synthetic non UUID demo context without parsing or writing production scope", () => {
    const demoActor = { ...context, organizationId: "demo-organization", branchId: "demo-branch", userId: "demo-user", demo: true };
    observeMedicationAuthority(medicationAuthoritySignature(demoActor));
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(() => render(element(true, true, demoActor))).not.toThrow();
    expect((screen.getByRole("button", { name: /展示模式只讀/u }) as HTMLButtonElement).disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it("visibly disables the 33rd distinct signing intent at the bounded saved guard limit", async () => {
    const pending = await import("@/lib/medications/pending");
    const scope = { organizationId: context.organizationId, branchId: context.branchId, userId: context.userId };
    for (let number = 1; number <= 32; number++) {
      const id = `33333333-3333-4333-8333-${String(number).padStart(12, "0")}`;
      const expected = { kind: "record" as const, medicationAdministrationId: id, status: "administered" as const, occurredAt: "2026-09-01T00:30:00.000Z", mustRequireSecondVerification: false };
      const active = pending.beginMedicationOperation(scope, JSON.stringify({ medication_administration_id: id }), expected,
        { status: "administered", occurredAt: "2026-09-01T08:30", reason: "" }, `synthetic-source-${number}`)!;
      expect(active).not.toBeNull();
      const response = await successFor(JSON.stringify({ occurred_at: expected.occurredAt })).json();
      response.data.medicationAdministrationId = id;
      expect(pending.confirmMedicationOperation(active, response, 201)).not.toBeNull();
    }
    expect(pending.getMedicationPending().saved).toHaveLength(32);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); renderScheduled();
    const trigger = screen.getByRole("button", { name: /記錄並簽署：本次登入已達待核對上限/u }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true); expect(screen.getByRole("status").textContent).toMatch(/核對已保存紀錄後安全登出重新登入/u);
    fireEvent.click(trigger); expect(screen.queryByRole("dialog")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    expect(pending.getMedicationPending().operation).toBeNull(); expect(pending.getMedicationPending().saved).toHaveLength(32);
  });
  it.each(["dose", "snapshot"])("new %s source cannot inherit unsubmitted signature consent", kind => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const view = renderScheduled();
    fireEvent.click(screen.getByRole("button", { name: "記錄並簽署" })); fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(<MedicationAction context={context} snapshotGeneratedAt={kind === "snapshot" ? "2026-09-01T00:31:00.000Z" : snapshot.generatedAt}
      canRecord canVerify currentUserId={context.userId} demo={false} hasRecentAal2 instance="desktop"
      row={kind === "dose" ? { ...scheduled, plannedDose: 2 } : scheduled} serviceDate={serviceDate} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/原紀錄已更新.*重新核對/u);
    fireEvent.click(screen.getByRole("button", { name: "確認執行並簽署" })); expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/勾選/u);
  });
});
