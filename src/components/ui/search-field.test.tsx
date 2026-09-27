// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
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
  it("supports the existing case-center code-unit query capacity without changing the GET default", () => {
    render(<form noValidate method="get"><SearchField defaultValue={"😀".repeat(60)} lengthUnit="code-units" label="搜尋個案" placeholder="找姓名" /></form>);
    const input = screen.getByRole("searchbox");
    const form = input.closest("form")!;
    expect(input).toHaveAttribute("maxlength", "120");
    expect(fireEvent.submit(form)).toBe(true);
    fireEvent.change(input, { target: { value: "😀".repeat(61) } });
    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("請縮短後再試");
    expect(input).toHaveValue("😀".repeat(61));
  });
});

describe("shared local work-list search", () => {
  function LocalSearch({ initialValue = "", onValueChange }: { initialValue?: string; onValueChange: (value: string) => void }) {
    const [value, setValue] = useState(initialValue);
    return <form noValidate><SearchField mode="local" value={value} onValueChange={(next) => { setValue(next); onValueChange(next); }}
      label="搜尋今日個案" placeholder="找姓名或代碼" /></form>;
  }
  it("updates and clears immediately without submitting a surrounding form", () => {
    const change = vi.fn();
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    render(<LocalSearch onValueChange={change} />);
    const input = screen.getByRole("searchbox", { name: "搜尋今日個案" });
    fireEvent.change(input, { target: { value: "TEST-001" } });
    expect(change).toHaveBeenLastCalledWith("TEST-001");
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋今日個案" }));
    expect(change).toHaveBeenLastCalledWith("");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("maxlength", "120");
    expect(submit).not.toHaveBeenCalled();
  });
  it("preserves composition input and does not clear until composition finishes", () => {
    const change = vi.fn();
    render(<LocalSearch initialValue="測試" onValueChange={change} />);
    const input = screen.getByRole("searchbox");
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋今日個案" }));
    expect(change).not.toHaveBeenCalled();
    expect(input).toHaveValue("測試");
    fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋今日個案" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("");
  });
  it("reflects parent resets rather than retaining an old clear button", () => {
    const change = vi.fn();
    const { rerender } = render(<SearchField mode="local" value="測試" onValueChange={change} label="搜尋個案" placeholder="找姓名" />);
    expect(screen.getByRole("button", { name: "清除搜尋個案" })).toBeEnabled();
    rerender(<SearchField mode="local" value="" onValueChange={change} label="搜尋個案" placeholder="找姓名" />);
    expect(screen.queryByRole("button", { name: "清除搜尋個案" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
