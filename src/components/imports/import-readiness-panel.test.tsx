// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportReadinessInput } from "@/lib/imports/readiness";
import { ImportReadinessPanel } from "./import-readiness-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const input: ImportReadinessInput = { sections: [], warnings: [], conflictCount: 0, mappingVersion: "test@1",
  fields: Array.from({ length: 43 }, (_, i) => ({ id: `field-${i}`, mappingKey: `key.${i}`,
    mappingState: i % 2 === 0 ? "mapped" as const : "unknown" as const, targetPath: null,
    displayValue: i === 0 ? "已遮罩" : `示例值 ${i}`, isMasked: i === 0,
    source: { sectionCode: "A", sectionTitle: "A 區段", label: `欄位 ${i}`, parentPath: i < 20 ? "A/一" : "A/二", controlName: null }, warnings: [] })) };

describe("import provenance browser", () => {
  it("makes every field accessible beyond the previous fourteen-field limit", () => {
    render(<ImportReadinessPanel input={input} />);
    expect(screen.getByRole("heading", { name: "欄位 19" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "欄位 20" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一頁欄位" }));
    expect(screen.getByRole("heading", { name: "欄位 39" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一頁欄位" }));
    expect(screen.getByRole("heading", { name: "欄位 42" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一頁欄位" })).toBeDisabled();
  });
  it("filters and resets pagination, counts come from the same snapshot", () => {
    render(<ImportReadinessPanel input={input} />);
    fireEvent.click(screen.getByRole("button", { name: "下一頁欄位" }));
    fireEvent.change(screen.getByLabelText("欄位狀態"), { target: { value: "unknown" } });
    expect(screen.getByRole("status")).toHaveTextContent("符合 21 欄");
    expect(screen.getByRole("button", { name: "上一頁欄位" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("來源區段"), { target: { value: "A/一" } });
    expect(screen.getByRole("status")).toHaveTextContent("符合 10 欄");
    fireEvent.click(screen.getByRole("button", { name: "清除欄位篩選" }));
    expect(screen.getByRole("status")).toHaveTextContent("符合 43 欄");
  });
  it("preserves masked values, never fetches or enables any write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { container } = render(<ImportReadinessPanel input={input} />);
    expect(screen.getByText("預覽值（已遮罩）：已遮罩")).toBeInTheDocument();
    expect(container.querySelector("form, input[type=file], iframe, img, script")).toBeNull();
    fireEvent.change(screen.getByLabelText("欄位狀態"), { target: { value: "conflict" } });
    expect(screen.getByRole("heading", { name: "沒有符合條件的欄位" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("renders untrusted source text as text, not executable HTML", () => {
    const bad = { ...input.fields[0]!, displayValue: '<img src="https://bad.invalid" onerror="alert(1)">' };
    const { container } = render(<ImportReadinessPanel input={{ ...input, fields: [bad] }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/onerror/u)).toBeInTheDocument();
  });
  it("keeps the promotion blocker visible and engineering evidence collapsed", () => {
    render(<ImportReadinessPanel input={{ ...input, fields: [input.fields[0]!] }} />);
    expect(screen.getByText("解析未發現待映射項目；仍不可正式匯入")).toBeInTheDocument();
    expect(screen.getByText("test@1").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("正式業務欄位與資料主權｜待驗收").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("解析未發現待映射項目；仍不可正式匯入").closest("details")).toBeNull();
    expect(screen.getByText("前往資料盤點與缺漏追蹤")).toHaveAttribute("href", "/app/staff/governance/integrations-audit#data-inventory");
    expect(screen.getByText("前往資料盤點與缺漏追蹤").closest("details")).not.toHaveAttribute("open");
  });
  it("keeps unknown sections, parser errors and field warnings outside collapsed details", () => {
    render(<ImportReadinessPanel input={{ ...input,
      fields: [{ ...input.fields[0]!, warnings: ["此欄位需要人工核對"] }],
      sections: [{ id: "section-1", index: 0, code: "unknown", title: "未辨識合成區段", sourceHeadingId: null, recognized: false }],
      warnings: [{ id: "warning-1", code: "TEST_ERROR", severity: "error", message: "合成來源格式需要確認" }],
    }} />);
    expect(screen.getByRole("region", { name: "未知來源區段" }).closest("details")).toBeNull();
    expect(screen.getByText("此欄位需要人工核對").closest("details")).toBeNull();
    expect(screen.getByText("錯誤：合成來源格式需要確認").closest("details")).toBeNull();
    expect(screen.getByText("仍有解析項目待核對")).toBeInTheDocument();
  });
});
