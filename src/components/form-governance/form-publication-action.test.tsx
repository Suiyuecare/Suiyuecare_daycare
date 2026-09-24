// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import { buildDemoFormGovernanceSnapshot } from "@/lib/form-governance/demo";
import type { FormGovernanceVersion } from "@/lib/form-governance/types";

import { FormPublicationAction } from "./form-publication-action";
import { FormRuleVersionsWorkspace } from "./form-rule-versions-workspace";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const version: FormGovernanceVersion = {
  id: "82100000-0000-4000-8000-000000000020",
  definitionId: "82000000-0000-4000-8000-000000000020",
  formKey: "tenant.strict_receipt",
  name: "嚴格回覆測試表單",
  category: "測試",
  official: false,
  version: 2,
  status: "draft",
  effectiveFrom: "2026-09-02",
  effectiveTo: null,
  schemaFieldCount: 2,
  scoringRuleCount: 1,
  publishedAt: null,
  contentHash: null,
  publication: null,
};

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
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("form publication browser boundary", () => {
  it("preserves legacy publication for same-prefix forms not eligible for the custom builder", () => {
    const snapshot = buildDemoFormGovernanceSnapshot(); snapshot.demo = false;
    snapshot.versions = [{ ...version, formKey: "tenant.custom.legacy_probe", customBuilderEligible: false }];
    render(<FormRuleVersionsWorkspace page={getPageBySlug("staff/governance/form-rule-versions")!} snapshot={snapshot}
      filters={{ query: "", status: "all", scope: "all", category: "all" }} canManage hasRecentAal2 />);
    expect(screen.getAllByRole("button", { name: "送出覆核" }).every(button => !(button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByRole("button", { name: "審閱欄位／送審歷程" })).toBeNull();
    expect(screen.queryByRole("button", { name: "編輯自訂草稿" })).toBeNull();
  });

  it("keeps a malformed 2xx open and reuses the same idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "82600000-0000-4000-8000-000000000020",
          status: "ok",
          data: {
            publication: {
              requestId: "82200000-0000-4000-8000-000000000020",
              formVersionId: "82100000-0000-4000-8000-000000000099",
              status: "pending",
              formContentHash: "a".repeat(64),
            },
            replayed: false,
            persisted: true,
            demo: false,
          },
          errors: [],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FormPublicationAction
        enabled
        instance="desktop"
        kind="request"
        version={version}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "送出覆核" }));
    const dialog = screen.getByRole("dialog", { name: "確認送出覆核" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.submit(dialog.querySelector("form")!);

    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /伺服器回覆不完整/u,
    );
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    const firstKey = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
      "Idempotency-Key",
    );
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);

    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
    ).toBe(firstKey);
  });

  it("accepts an exact correlated receipt and refreshes the audited snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "82600000-0000-4000-8000-000000000021",
            status: "ok",
            data: {
              publication: {
                requestId: "82200000-0000-4000-8000-000000000021",
                formVersionId: version.id,
                status: "pending",
                formContentHash: "b".repeat(64),
              },
              replayed: false,
              persisted: true,
              demo: false,
            },
            errors: [],
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <FormPublicationAction
        enabled
        instance="desktop"
        kind="request"
        version={version}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "送出覆核" }));
    const dialog = screen.getByRole("dialog", { name: "確認送出覆核" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.submit(dialog.querySelector("form")!);

    expect(await within(dialog).findByText(/送審已保存/u)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("renders demo as explicitly read-only and never enables publication actions", () => {
    render(
      <FormRuleVersionsWorkspace
        canManage
        filters={{ query: "", status: "all", scope: "all", category: "all" }}
        hasRecentAal2
        page={getPageBySlug("staff/governance/form-rule-versions")!}
        snapshot={buildDemoFormGovernanceSnapshot()}
      />,
    );

    expect(screen.getByText(/展示唯讀模式/u)).toBeTruthy();
    expect(screen.getByText(/複製改版及雙人覆核停用/u)).toBeTruthy();
    expect(screen.getByText(/不執行計分公式、不改官方版本/u)).toBeTruthy();
    const mutationButtons = screen.getAllByRole("button", {
      name: /送出覆核|核准並發布|改版／停用歷程/u,
    });
    expect(mutationButtons.length).toBeGreaterThan(0);
    expect(
      mutationButtons.every((button) =>
        (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
  });

  it("blocks all publication decisions when any bounded list is incomplete", () => {
    const snapshot = {
      ...buildDemoFormGovernanceSnapshot(),
      demo: false,
      versionTotal: buildDemoFormGovernanceSnapshot().versionTotal + 1,
      versionsTruncated: true,
      incomplete: true,
    };
    render(
      <FormRuleVersionsWorkspace
        canManage
        filters={{ query: "", status: "all", scope: "all", category: "all" }}
        hasRecentAal2
        page={getPageBySlug("staff/governance/form-rule-versions")!}
        snapshot={snapshot}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/清單完整前已停用/u);
    expect(screen.getAllByText(/已載入部分，非總數/u)).toHaveLength(4);
    expect(
      screen.getAllByRole("button", { name: /送出覆核|核准並發布|審閱欄位／送審歷程/u })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
