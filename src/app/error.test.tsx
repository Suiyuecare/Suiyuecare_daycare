// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

afterEach(cleanup);
describe("route error recovery", () => {
  it("states only loading failure, not an unproved save outcome", () => {
    render(<ErrorPage reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "目前無法載入" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("先核對原筆保存結果");
    expect(screen.getByRole("alert").textContent).toContain("不要重新建一筆");
    expect(screen.getByRole("alert").textContent).not.toContain("資料沒有被送出");
    expect(screen.getByRole("alert").textContent).not.toContain("請求編號");
  });
  it("only invokes the existing reset action on explicit retry", () => {
    const reset = vi.fn(); render(<ErrorPage reset={reset} />);
    expect(reset).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "再試一次" });
    expect(button.getAttribute("type")).toBe("button");
    fireEvent.click(button); expect(reset).toHaveBeenCalledTimes(1);
  });
});
