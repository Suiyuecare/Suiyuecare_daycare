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
].map((slug) => getPageBySlug(slug)!);

afterEach(cleanup);

describe("assessment entry workspace", () => {
  it("asks for a client first and links available draft forms to that exact client", () => {
    const { unmount } = render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} selectedClientId={null}
    />);

    const picker = screen.getByRole("combobox", { name: "個案" });
    expect(picker).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("選取個案後");
    expect(screen.queryByText("正式題本與簽署尚未啟用")).not.toBeInTheDocument();

    unmount();
    render(<AssessmentEntryWorkspace
      clients={[client]} error={false} pages={pages} selectedClientId={client.id}
    />);
    expect(screen.getByText("合成測試個案")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
    expect(screen.getByText("草稿不等同正式量表結果；正式題本與簽署尚未啟用。")).toBeVisible();

    const cards = screen.getAllByRole("link").filter((link) => link.textContent?.includes("候選草稿"));
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(pages.map((page) =>
      `/app/${page.slug}?client=${encodeURIComponent(client.id)}`));
    expect(screen.queryByRole("link", { name: /吞嚥評估/ })).not.toBeInTheDocument();
  });

  it("shows a short actionable error instead of an empty-looking page", () => {
    render(<AssessmentEntryWorkspace clients={[]} error={true} pages={[]} selectedClientId={null} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { name: "個案清單載入失敗" })).toBeVisible();
    expect(within(alert).getByText("資料沒有變更。請重新載入。")).toBeVisible();
    expect(within(alert).getByRole("link", { name: "重新載入" })).toHaveAttribute(
      "href", "/app/staff/assessments/swallowing",
    );
  });

  it("requires a selection before opening a form", () => {
    render(<AssessmentEntryWorkspace clients={[client]} error={false} pages={pages} selectedClientId={null} />);
    const form = screen.getByRole("combobox", { name: "個案" }).closest("form");
    expect(form).toHaveAttribute("action", "/app/staff/assessments/swallowing");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByRole("button", { name: "開始" })).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "個案" }), { target: { value: client.id } });
    expect(screen.getByRole("combobox", { name: "個案" })).toHaveValue(client.id);
  });
});
