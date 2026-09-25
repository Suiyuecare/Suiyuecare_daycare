// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";

import { AssessmentEntryWorkspace } from "./assessment-entry-workspace";

const client: ClientMasterItem = {
  id: "c1600000-0000-4000-8000-000000000001",
  clientCode: "SYN-001",
  displayName: "合成測試個案",
  dateOfBirth: null,
  status: "active",
  serviceState: "active",
  admittedOn: "2026-09-01",
  endedOn: null,
  sourceSystem: "synthetic",
  sourceAuthority: "local",
  sourceUpdatedAt: null,
  rowVersion: 1,
  updatedAt: "2026-09-24T00:00:00Z",
  editable: true,
  editBlockReason: null,
};

const pages = [
  "staff/assessments/spmsq",
  "staff/assessments/gds",
  "staff/assessments/fall-risk",
  "staff/assessments/nsi",
  "staff/assessments/physical",
  "staff/assessments/behavior-emotion",
  "staff/assessments/abcd",
  "staff/social-work/psychosocial-assessment",
  "staff/social-work/adaptation-assessment",
  "staff/professional-care/occupational-assessment",
  "staff/professional-care/physical-assessment",
  "staff/professional-care/chewing",
  "staff/service-management/nursing-assessment",
].map((slug) => getPageBySlug(slug)!);
const unavailablePages = [
  "staff/assessments/barthel-adl",
  "staff/assessments/iadl",
  "staff/assessments/swallowing",
  "staff/assessments/bsrs",
  "staff/professional-care/mna",
].map((slug) => getPageBySlug(slug)!);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("assessment entry workspace", () => {
  it("asks for a client first and links available draft forms to that exact client", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { snapshot: {
      clientId: client.id, records: [], total: 0, hasMore: false, generatedAt: "2026-09-25T00:00:00Z",
    } } }), { status: 200, headers: { "content-type": "application/json" } })));
    const { unmount } = render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} unavailablePages={unavailablePages} selectedClientId={null}
    />);

    const picker = screen.getByRole("combobox", { name: "個案" });
    expect(picker).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("選取個案後");
    expect(screen.queryByRole("heading", { name: "尚未開放正式填寫" })).not.toBeInTheDocument();

    unmount();
    render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} unavailablePages={unavailablePages} selectedClientId={client.id}
      canReadExternalResults canWriteExternalResults
    />);
    expect(screen.getByText("合成測試個案")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
    expect(screen.getByText(/已取得公開原始碼授權確認/u)).toBeVisible();

    const cards = screen.getAllByRole("link").filter((link) =>
      link.getAttribute("href")?.startsWith("/app/") && !link.getAttribute("href")?.includes("externalInstrument"));
    expect(cards).toHaveLength(pages.length);
    const orderedPages = [
      ...pages.filter((page) => [11, 12, 13, 21].includes(page.number)),
      ...pages.filter((page) => [14, 35].includes(page.number)),
      ...pages.filter((page) => ![11, 12, 13, 14, 21, 35].includes(page.number)),
    ];
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(orderedPages.map((page) =>
      `/app/${page.slug}?client=${encodeURIComponent(client.id)}`));
    expect(screen.getByRole("heading", { name: "尚未開放正式填寫" })).toBeVisible();
    expect(screen.getByRole("link", { name: /吞嚥評估.*登錄外部結果/ })).toHaveAttribute(
      "href", `/app/staff/assessments/swallowing?client=${encodeURIComponent(client.id)}&externalInstrument=swallowing#external-result-entry`,
    );
    expect(screen.getByRole("heading", { name: "登錄評估結果" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "量表／評估工具" })).toHaveValue("barthel_adl");
    expect(screen.getByText(/已收到授權確認；逐題作答與安全保存流程尚未接通/u)).toBeVisible();
    expect(screen.getByRole("heading", { name: "候選草稿・非正式量表" })).toBeVisible();
    expect(screen.getByText("衛福部 SPMSQ 10 題可填；分數仍是候選值")).toBeVisible();
    expect(screen.getByText("人工觀察草稿；不是標準化跌倒量表")).toBeVisible();
    expect(screen.getByRole("heading", { name: "人工觀察草稿" })).toBeVisible();
    expect(screen.queryByText("可填寫草稿")).not.toBeInTheDocument();
  });

  it("shows a short actionable error instead of an empty-looking page", () => {
    render(<AssessmentEntryWorkspace clients={[]} error={true} pages={[]} unavailablePages={[]} selectedClientId={null} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "個案清單載入失敗" })).toBeVisible();
    expect(within(alert).getByText("資料沒有變更。請重新載入。")).toBeVisible();
    expect(within(alert).getByRole("link", { name: "重新載入" })).toHaveAttribute(
      "href", "/app/staff/assessments/swallowing",
    );
  });

  it("requires a selection before opening a form", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages} unavailablePages={unavailablePages} selectedClientId={null} />);
    const form = screen.getByRole("combobox", { name: "個案" }).closest("form");
    expect(form).toHaveAttribute("action", "/app/staff/assessments/swallowing");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), { target: { value: client.id } });
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
  });
});
