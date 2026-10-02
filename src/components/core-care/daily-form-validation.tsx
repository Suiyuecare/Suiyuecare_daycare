"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

type FieldErrors = Record<string, string>;
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The daily forms share field feedback; native picker popups remain platform-owned. */
export function useDailyFormValidation() {
  const prefix = useId();
  const composing = useRef(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  function clear(name: string) {
    setErrors((prior) => {
      if (!prior[name]) return prior;
      const next = { ...prior }; delete next[name]; return next;
    });
  }
  return {
    errors,
    composing,
    reset() { setErrors({}); composing.current = false; },
    clear,
    clearChanged(target: EventTarget) {
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) clear(target.name);
    },
    field(name: string, hint?: string, labelled = true) {
      return {
        "aria-labelledby": labelled ? `${prefix}-${name}-label` : undefined,
        "aria-invalid": errors[name] ? true as const : undefined,
        "aria-describedby": [hint, errors[name] ? `${prefix}-${name}-error` : undefined].filter(Boolean).join(" ") || undefined,
      };
    },
    errorId(name: string) { return `${prefix}-${name}-error`; },
    labelId(name: string) { return `${prefix}-${name}-label`; },
    onCompositionStart() { composing.current = true; },
    onCompositionEnd() { composing.current = false; },
    onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
      if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
    },
    validate(form: HTMLFormElement, extra: FieldErrors = {}) {
      const next: FieldErrors = {};
      const controls = Array.from(form.elements).filter((control): control is FormControl =>
        control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement);
      for (const control of controls) {
        if (!control.name || !control.willValidate) continue;
        const label = (control.labels?.[0]?.querySelector("span")?.textContent ?? control.labels?.[0]?.textContent ?? control.getAttribute("aria-label") ?? "此欄位").replace(/\s*\*\s*$/u, "").trim();
        const { validity } = control;
        if (validity.valueMissing || (control.required && !control.value.trim())) next[control.name] = `請填寫${label}。`;
        else if (validity.badInput || validity.typeMismatch || validity.patternMismatch) next[control.name] = `請確認${label}的格式。`;
        else if (validity.rangeUnderflow || validity.rangeOverflow) next[control.name] = `請輸入 ${control.getAttribute("min")} 至 ${control.getAttribute("max")} 的${label}。`;
        else if (validity.stepMismatch) next[control.name] = control.getAttribute("step") === "0.1" ? "體溫請填至小數點後一位。" : `請填寫整數的${label}。`;
        else if (validity.tooLong || (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) && control.maxLength >= 0 && control.value.length > control.maxLength) next[control.name] = `請縮短${label}的內容。`;
      }
      Object.assign(next, extra);
      setErrors(next);
      const first = controls.find((control) => next[control.name] && control.willValidate);
      first?.focus();
      first?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
      return Object.keys(next).length === 0;
    },
  };
}

export type DailyFormValidation = ReturnType<typeof useDailyFormValidation>;

export function DailyFieldError({ validation, name }: { validation: DailyFormValidation; name: string }) {
  return validation.errors[name] ? <small className="form-error" id={validation.errorId(name)}>{validation.errors[name]}</small> : null;
}

export function DailyValidationSummary({ validation }: { validation: DailyFormValidation }) {
  return Object.keys(validation.errors).length ? <p className="form-error" role="alert">{Object.values(validation.errors)[0]} 請修正標示的欄位，內容已保留。</p> : null;
}
