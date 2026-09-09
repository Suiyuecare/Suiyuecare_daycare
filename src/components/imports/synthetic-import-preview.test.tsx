// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildSyntheticImportPreview } from "@/lib/imports/synthetic-preview-sample";
import { SyntheticImportPreview } from "./synthetic-import-preview";

afterEach(cleanup);
describe("online read-only import preview", () => {
  it("statically parses only the developer-authored sample without dropping unknown fields", () => {
    const result = buildSyntheticImportPreview();
    expect(result.sections).toHaveLength(3);
    expect(result.fields.length).toBeGreaterThanOrEqual(4);
    expect(result.fields.some((field) => field.mappingState === "unknown")).toBe(true);
    expect(result.security.externalRequestCount).toBe(0);
  });
  it("never renders an upload, raw HTML, remote media or approval control", () => {
    const { container } = render(<SyntheticImportPreview />);
    expect(screen.getByRole("heading", { name: "中央 HTML 匯入", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("已解析")).toBeInTheDocument();
    expect(screen.getByText("待核對／暫存核准")).toBeInTheDocument();
    expect(screen.getByText("正式入檔尚未完成")).toBeInTheDocument();
    expect(screen.getByText(/不是您提供的三份真實個案檔案/u)).toBeInTheDocument();
    expect(screen.getByText(/展示個案\(非真人\)/u)).toBeInTheDocument();
    expect(screen.getAllByText("central-care-plan-html@1").length).toBeGreaterThan(0);
    expect(screen.getByText("central-care-plan-html@1").closest("details")).not.toHaveAttribute("open");
    expect(container.querySelector("form, input, iframe, script, img")).toBeNull();
    expect(screen.getByText("前往資料盤點與缺漏追蹤")).toHaveAttribute("href", "/app/staff/governance/integrations-audit#data-inventory");
    expect(screen.getByText("前往資料盤點與缺漏追蹤").closest("details")).not.toHaveAttribute("open");
  });
});
