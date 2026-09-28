// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(screen.getByText("合成測試個案")).toBeVisible();
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
    expect(screen.getByText("SPMSQ・10 題")).toBeVisible();
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
    expect(screen.queryByRole("heading", { name: "開始評估" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveTextContent("請按「開始」切換個案");
    expect(screen.queryByRole("link", { name: /SPMSQ 評估/u })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: client.id } });
    expect(screen.getByRole("link", { name: /SPMSQ 評估/u })).toHaveAttribute("href", `/app/staff/assessments/spmsq?client=${client.id}`);
  });

  it("requires a selection before opening a form", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages} selectedClientId={null} />);
    const form = screen.getByRole("combobox", { name: "個案" }).closest("form");
    expect(form).toHaveAttribute("action", "/app/assessments");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("novalidate");
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "開始" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("目前沒有可查看的個案");
  });
});
