// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getPageBySlug } from "@/lib/catalog";
import type { ClientMasterItem } from "@/lib/clients/master-types";
import type { QuestionnaireResumeSummary } from "@/lib/questionnaire-assessments/resume-summary";
import type { QuestionnaireFormKey } from "@/lib/questionnaire-assessments/types";

import { AssessmentEntryWorkspace } from "./assessment-entry-workspace";
import { AssessmentClientPicker } from "./assessment-client-picker";

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
  "staff/assessments/barthel-adl",
  "staff/assessments/iadl",
  "staff/assessments/swallowing",
  "staff/assessments/bsrs",
  "staff/assessments/physical",
  "staff/assessments/behavior-emotion",
  "staff/assessments/abcd",
  "staff/social-work/psychosocial-assessment",
  "staff/social-work/adaptation-assessment",
  "staff/professional-care/occupational-assessment",
  "staff/professional-care/physical-assessment",
  "staff/professional-care/chewing",
  "staff/professional-care/mna",
  "staff/service-management/nursing-assessment",
].map((slug) => getPageBySlug(slug)!);
const questionnaireKeys: readonly QuestionnaireFormKey[] = [
  "spmsq", "gds_15", "fall_risk_taipei_115", "nsi_determine", "barthel_adl",
  "lawton_iadl", "eat10_swallowing", "bsrs5", "mna_sf",
];
const assessmentKey = "c2600000-0000-4000-8000-000000000001";
const versionId = "c3600000-0000-4000-8000-000000000001";
const summary = (latest: QuestionnaireResumeSummary["forms"][number]["latest"] = null): QuestionnaireResumeSummary => ({
  clientId: client.id,
  generatedAt: "2026-10-02T01:32:00Z",
  forms: questionnaireKeys.map((formKey) => ({ formKey, latest: formKey === "spmsq" ? latest : null })),
});
afterEach(() => { cleanup(); });

describe("assessment entry workspace", () => {
  it("asks for a client first and links available draft forms to that exact client", () => {
    const { unmount } = render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} selectedClientId={null}
    />);

    const picker = screen.getByRole("combobox", { name: "個案" });
    expect(picker).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("選取個案後");
    expect(screen.queryByRole("heading", { name: "尚未開放正式填寫" })).not.toBeInTheDocument();

    unmount();
    render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} selectedClientId={client.id}
    />);
    expect(screen.getByRole("heading", { name: "合成測試個案的評估表" })).toBeVisible();
    expect(screen.getByText("SYN-001")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
    expect(screen.getByText("保存與簽署依您的個案分工與表單權限；結果仍須專業判讀。")).not.toBeVisible();
    fireEvent.click(screen.getByText("填寫前須知"));
    expect(screen.getByText("保存與簽署依您的個案分工與表單權限；結果仍須專業判讀。")).toBeVisible();

    const secondaryGroups = [...document.querySelectorAll("details")]
      .filter((details) => /人工觀察草稿|人工評估與照顧紀錄/u.test(details.querySelector("summary")?.textContent ?? ""));
    expect(secondaryGroups).toHaveLength(2);
    expect(secondaryGroups.every((details) => !details.open)).toBe(true);
    fireEvent.click(secondaryGroups[0]!.querySelector("summary")!);
    fireEvent.click(secondaryGroups[1]!.querySelector("summary")!);
    expect(secondaryGroups.every((details) => details.open)).toBe(true);

    const cards = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/app/"));
    expect(cards).toHaveLength(pages.length);
    const candidateNumbers = [11, 12, 13, 14, 15, 16, 17, 18, 36];
    const orderedPages = [
      ...pages.filter((page) => candidateNumbers.includes(page.number)),
      ...pages.filter((page) => page.number === 35),
      ...pages.filter((page) => !candidateNumbers.includes(page.number) && page.number !== 35),
    ];
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(orderedPages.map((page) =>
      `/app/${page.slug}?client=${encodeURIComponent(client.id)}`));
    expect(screen.getByRole("heading", { name: "題目式量表" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "尚未開放正式填寫" })).not.toBeInTheDocument();
    for (const slug of [
      "staff/assessments/spmsq", "staff/assessments/gds", "staff/assessments/fall-risk",
      "staff/assessments/nsi", "staff/assessments/barthel-adl", "staff/assessments/iadl",
      "staff/assessments/swallowing", "staff/assessments/bsrs", "staff/professional-care/mna",
    ]) expect(cards.some((card) => card.getAttribute("href") === `/app/${slug}?client=${encodeURIComponent(client.id)}`)).toBe(true);
    expect(screen.queryByRole("heading", { name: "登錄評估結果" })).not.toBeInTheDocument();
    expect(secondaryGroups[0]!.querySelector("summary")).toHaveTextContent("人工觀察草稿 1");
    expect(screen.getByRole("link", { name: /SPMSQ 評估.*草稿狀態無法確認.*開啟量表/u })).toBeVisible();
  });

  it("continues the exact saved draft with a Taiwan-time status instead of guessing from assessment date", () => {
    const latest = { assessmentKey, versionId, version: 3, assessedOn: "2026-09-15",
      savedAt: "2026-10-02T01:30:00Z", recordState: "draft" as const };
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} resume={summary(latest)} manageableFormKeys={["spmsq", "gds_15"]} />);
    const savedLink = screen.getByRole("link", { name: /SPMSQ 評估.*草稿.*最近保存.*接續填寫/u });
    expect(savedLink).toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}&assessment=${assessmentKey}&version=${versionId}`);
    expect(savedLink).toHaveTextContent(/最近保存.*10\/02.*09:30/u);
    expect(screen.getByText(/資料截至.*10\/02.*09:32/u)).toBeVisible();
    expect(screen.getByRole("link", { name: /GDS 老人憂鬱量表.*尚無已保存草稿.*開始填寫/u }))
      .toHaveAttribute("href", `/app/staff/assessments/gds?client=${client.id}`);
    expect(screen.queryByText("草稿狀態暫時無法確認。可開啟量表核對。")).not.toBeInTheDocument();
  });

  it("offers read-only access without promising that the user can continue editing", () => {
    const latest = { assessmentKey, versionId, version: 1, assessedOn: "2026-09-15",
      savedAt: "2026-10-02T01:30:00Z", recordState: "draft" as const };
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} resume={summary(latest)} manageableFormKeys={[]} />);
    expect(screen.getByRole("link", { name: /SPMSQ 評估.*查看草稿/u })).toHaveAttribute("href",
      `/app/staff/assessments/spmsq?client=${client.id}&assessment=${assessmentKey}&version=${versionId}`);
    expect(screen.queryByRole("link", { name: /接續填寫/u })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GDS 老人憂鬱量表.*開啟量表/u })).toBeVisible();
  });

  it("never calls a failed or omitted metadata result an empty draft list", () => {
    const previouslyLoaded = summary({ assessmentKey, versionId, version: 1, assessedOn: "2026-09-15",
      savedAt: "2026-10-02T01:30:00Z", recordState: "draft" });
    const { rerender } = render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} resume={previouslyLoaded} resumeError />);
    expect(screen.getByText("草稿狀態暫時無法確認。可開啟量表核對。")).toBeVisible();
    expect(screen.getByRole("link", { name: /SPMSQ 評估.*草稿狀態無法確認.*開啟量表/u }))
      .toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}`);
    expect(screen.queryByText("尚無已保存草稿")).not.toBeInTheDocument();

    rerender(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} resume={{ ...summary(), forms: summary().forms.slice(1) }} />);
    expect(screen.getByRole("link", { name: /SPMSQ 評估.*草稿狀態無法確認.*開啟量表/u })).toBeVisible();
    expect(screen.getByRole("link", { name: /GDS 老人憂鬱量表.*尚無已保存草稿/u })).toBeVisible();

    rerender(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} resume={{ ...summary(), clientId: "c1600000-0000-4000-8000-000000000002" }} />);
    expect(screen.getByText("草稿狀態暫時無法確認。可開啟量表核對。")).toBeVisible();
    expect(screen.queryByText("尚無已保存草稿")).not.toBeInTheDocument();
  });

  it("shows demo forms without attaching real draft identifiers or a save action", () => {
    const latest = { assessmentKey, versionId, version: 1, assessedOn: "2026-09-15",
      savedAt: "2026-10-02T01:30:00Z", recordState: "draft" as const };
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} demo resume={summary(latest)} manageableFormKeys={["spmsq"]} />);
    const link = screen.getByRole("link", { name: /SPMSQ 評估.*展示資料不可保存.*查看量表/u });
    expect(link).toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}`);
    expect(link.getAttribute("href")).not.toContain("assessment=");
    expect(screen.queryByText(/最近保存/u)).not.toBeInTheDocument();
    expect(screen.getByText("展示資料僅供試看；不可保存或簽署。")).toBeVisible();
  });

  it("does not render a form that was removed from the authorized page catalog", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false}
      pages={pages.filter((page) => page.number !== 11)} selectedClientId={client.id}
      resume={summary({ assessmentKey, versionId, version: 1, assessedOn: "2026-09-15",
        savedAt: "2026-10-02T01:30:00Z", recordState: "draft" })}
      manageableFormKeys={["spmsq"]} />);
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GDS 老人憂鬱量表/u })).toBeVisible();
  });

  it("focuses the selected client's form list after the explicit start navigation", () => {
    window.history.replaceState(null, "", "/app/assessments#assessment-forms");
    try {
      render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages} selectedClientId={client.id} />);
      expect(screen.getByRole("region", { name: "合成測試個案的評估表" })).toHaveFocus();
    } finally {
      window.history.replaceState(null, "", "/app/assessments");
    }
  });

  it("shows a short actionable error instead of an empty-looking page", () => {
    render(<AssessmentEntryWorkspace clients={[]} error={true} pages={[]} selectedClientId={null} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "個案清單載入失敗" })).toBeVisible();
    expect(within(alert).getByText("資料沒有變更。請重新載入。")).toBeVisible();
    expect(within(alert).getByRole("link", { name: "重新載入" })).toHaveAttribute(
      "href", "/app/assessments",
    );
  });

  it("does not reveal a different client for a rejected deep link", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={null} selectionRejected />);
    expect(screen.getByRole("alert")).toHaveTextContent("這位個案目前無法選取");
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "合成測試個案的評估表" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();
  });

  it("does not describe disabled demo questionnaires as writable or saved", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages}
      selectedClientId={client.id} demo />);
    expect(screen.getByRole("heading", { name: "展示量表（不可保存）" })).toBeVisible();
    expect(screen.getByText("展示資料僅供試看；不可保存或簽署。")).toBeVisible();
    fireEvent.click(screen.getByText("填寫前須知"));
    expect(screen.getByText("外部評估結果登錄尚未開放，請勿在此輸入敏感資料。")).toBeVisible();
    expect(screen.queryByText(/答案會以草稿版本保存/u)).not.toBeInTheDocument();
  });

  it("hides the old client's form links immediately while a different client is selected", () => {
    const other = { ...client, id: "c1600000-0000-4000-8000-000000000002", clientCode: "SYN-002", displayName: "另一位合成個案" };
    render(<AssessmentEntryWorkspace clients={[client, other]} error={false} pages={pages}
      selectedClientId={client.id} />);
    const picker = screen.getByRole("combobox", { name: "個案" });
    expect(screen.getByRole("link", { name: /SPMSQ 評估/u })).toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}`);
    fireEvent.change(picker, { target: { value: other.id } });
    expect(screen.getByRole("status")).toHaveTextContent("請按「查看表單」切換個案");
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: client.id } });
    expect(screen.getByRole("link", { name: /SPMSQ 評估/u })).toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}`);
  });

  it("requires a selection before opening a form", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages} selectedClientId={null} />);
    const form = screen.getByRole("combobox", { name: "個案" }).closest("form");
    expect(form).toHaveAttribute("action", "/app/assessments#assessment-forms");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("novalidate");
    expect(screen.getByRole("button", { name: "查看表單" })).toBeEnabled();
    expect(fireEvent.submit(form!)).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("請先選擇個案");
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveAttribute("aria-describedby", "assessment-client-error");
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveFocus();
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), { target: { value: client.id } });
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fireEvent.submit(form!)).toBe(true);
  });

  it("does not offer a fake start action when no authorized clients are available", () => {
    render(<AssessmentEntryWorkspace clients={[]} error={false} pages={pages} selectedClientId={null} />);
    expect(screen.getByRole("button", { name: "查看表單" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("目前沒有可查看的個案");
  });

  it("searches a large authorized roster locally without silently changing the selected client", () => {
    const roster = Array.from({ length: 500 }, (_, index) => ({
      ...client,
      id: `c1600000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      clientCode: `SYN-${String(index + 1).padStart(3, "0")}`,
      displayName: `合成個案 ${index + 1}`,
    }));
    render(<AssessmentEntryWorkspace clients={roster} error={false} pages={pages}
      selectedClientId={roster[0]!.id} />);
    const picker = screen.getByRole("combobox", { name: "個案" });
    const search = screen.getByRole("searchbox", { name: "搜尋個案" });
    fireEvent.change(search, { target: { value: "SYN-500" } });
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("找到 1 位個案"))).toBe(true);
    expect(within(picker).getAllByRole("option")).toHaveLength(3);
    expect(within(picker).getByRole("option", { name: /原選取（不符搜尋）/u })).toHaveValue(roster[0]!.id);
    expect(picker).toHaveValue(roster[0]!.id);
    expect(screen.getByRole("button", { name: "查看表單" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();

    fireEvent.change(picker, { target: { value: roster[499]!.id } });
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋個案" }));
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    expect(picker).toHaveValue(roster[499]!.id);
    expect(within(picker).getAllByRole("option")).toHaveLength(501);
    expect(screen.getByRole("button", { name: "查看表單" })).toBeEnabled();
  });

  it("clears hidden search state and rejects a draft client removed from the authorized roster", () => {
    const roster = Array.from({ length: 15 }, (_, index) => ({
      id: `c1600000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      clientCode: `SYN-${String(index + 1).padStart(3, "0")}`,
      displayName: `合成個案 ${index + 1}`,
    }));
    const { rerender } = render(<AssessmentClientPicker clients={roster} selectedClientId={null}>
      <p>原個案內容</p>
    </AssessmentClientPicker>);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜尋個案" }), { target: { value: "SYN-015" } });
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), { target: { value: roster[14]!.id } });
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(roster[14]!.id);

    rerender(<AssessmentClientPicker clients={roster.slice(0, 10)} selectedClientId={null}>
      <p>原個案內容</p>
    </AssessmentClientPicker>);
    expect(screen.queryByRole("searchbox", { name: "搜尋個案" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue("");
    expect(within(screen.getByRole("combobox", { name: "個案" })).getAllByRole("option")).toHaveLength(11);
    expect(screen.getByRole("button", { name: "查看表單" })).toBeDisabled();
    expect(fireEvent.submit(screen.getByRole("combobox", { name: "個案" }).closest("form")!)).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("目前無法選取");
  });
});
