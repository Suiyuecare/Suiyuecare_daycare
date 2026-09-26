// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchField } from "./search-field";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(value = "") {
  return render(<form noValidate method="get"><SearchField defaultValue={value} label="搜尋公告" placeholder="搜尋標題或內容" /><input name="page" type="hidden" value="1" /><select name="status" defaultValue="published"><option value="published">已發布</option></select><button>套用</button></form>);
}
describe("shared explicit search", () => {
  it("has a label and no false clear affordance while empty", () => {
    mount(); expect(screen.getByRole("searchbox", { name: "搜尋公告" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "清除搜尋公告" })).not.toBeInTheDocument();
  });
  it("does not submit on typing; clear immediately commits blank query with other filters and first page", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    mount(); const input = screen.getByRole("searchbox"); fireEvent.change(input, { target: { value: "交班" } });
    expect(submit).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "清除搜尋公告" }));
    expect(input).toHaveValue(""); expect(input).toHaveFocus(); expect(submit).toHaveBeenCalledOnce();
    const data = new FormData(input.closest("form")!);
    expect(data.get("q")).toBe(""); expect(data.get("status")).toBe("published"); expect(data.get("page")).toBe("1");
  });
  it("offers app-owned clear for a committed query", () => {
    mount("夜班"); expect(screen.getByRole("button", { name: "清除搜尋公告" })).toBeEnabled();
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxlength", "240");
  });
  it("does not submit composition-confirm Enter, including browser native isComposing", () => {
    mount(); const input = screen.getByRole("searchbox");
    fireEvent.compositionStart(input); expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    fireEvent.compositionEnd(input); expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  });
  it("accepts 120 Unicode code points but rejects 121 without silently truncating", () => {
    mount("😀".repeat(120)); const input = screen.getByRole("searchbox"); const form = input.closest("form")!;
    expect(fireEvent.submit(form)).toBe(true); fireEvent.change(input, { target: { value: "😀".repeat(121) } });
    expect(fireEvent.submit(form)).toBe(false); expect(input).toHaveValue("😀".repeat(121));
    expect(input).toHaveAttribute("aria-invalid", "true"); expect(input).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("120 字以內");
  });
  it("does not clear or dispatch a query while composition is active", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    mount("交班"); const input = screen.getByRole("searchbox"); fireEvent.compositionStart(input);
    const clear = screen.getByRole("button", { name: "清除搜尋公告" }); expect(clear).toBeDisabled();
    fireEvent.click(clear); expect(input).toHaveValue("交班"); expect(submit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); expect(clear).toBeEnabled();
  });
});
