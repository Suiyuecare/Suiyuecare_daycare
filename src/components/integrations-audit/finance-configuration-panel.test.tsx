// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FinanceConfigurationPanel } from "./finance-configuration-panel";
afterEach(cleanup);
describe("Finance operator setup checklist", () => {
  it("shows actionable missing items and no secret inputs", () => {
    const { container } = render(<FinanceConfigurationPanel check={{ status: "missing", missing: ["FINANCE_STORE_SUMMARY_TOKEN", "FINANCE_STORE_ENTITY_ID"], invalid: [], connectionVerified: false }} />);
    expect(screen.getByRole("status")).toHaveTextContent("尚缺連線設定");
    expect(screen.getByText("專用連線憑證")).toBeInTheDocument();
    expect(screen.getByText("Finance 店別／法人對應")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("input,textarea")).toBeNull();
  });
  it("configuration pass is not described as actual connectivity", () => {
    render(<FinanceConfigurationPanel canOpenOverview check={{ status: "configured_unverified", missing: [], invalid: [], connectionVerified: false }} />);
    expect(screen.getByRole("status")).toHaveTextContent("待實際連線驗收");
    expect(screen.getByRole("link", { name: "開啟單店出勤與收支" })).toHaveAttribute("href", "/app/store-overview");
    expect(screen.getByText(/不代表已連通或完成財務對帳/)).toBeInTheDocument();
  });
  it("explains mismatched store rather than showing another store's IDs or amounts", () => {
    render(<FinanceConfigurationPanel check={{ status: "scope_mismatch", missing: [], invalid: [], connectionVerified: false }} />);
    expect(screen.getByRole("status")).toHaveTextContent("目前分支不符");
    expect(screen.getByText(/不會讀取或顯示其他店的金額/)).toBeInTheDocument();
  });
});
