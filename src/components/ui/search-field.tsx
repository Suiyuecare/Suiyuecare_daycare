"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./search-field.module.css";

/** Explicit GET search: no request on keystrokes; clear commits immediately. */
export function SearchField({ defaultValue, label, placeholder, name = "q", maxLength = 120 }: {
  defaultValue: string; label: string; placeholder: string; name?: string; maxLength?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [hasValue, setHasValue] = useState(Boolean(defaultValue));
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => {
    const element = input.current;
    const form = element?.form;
    if (!form || !element) return;
    const validate = (event: Event) => {
      if (composing.current) { event.preventDefault(); return; }
      if ([...element.value].length > maxLength) {
        event.preventDefault(); setError(`請輸入 ${maxLength} 字以內的搜尋文字。`); element.focus();
      }
    };
    form.addEventListener("submit", validate);
    return () => form.removeEventListener("submit", validate);
  }, [maxLength]);
  return <div className={`filter-search ${styles.search}`}>
    <div className={styles.control}><label><Search aria-hidden="true" /><span className="sr-only">{label}</span>
      <input ref={input} name={name} type="search" autoComplete="off" defaultValue={defaultValue}
        maxLength={maxLength * 2} placeholder={placeholder} aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => { setHasValue(Boolean(event.target.value)); setError(""); }}
        onCompositionStart={() => { composing.current = true; setIsComposing(true); }}
        onCompositionEnd={() => { composing.current = false; setIsComposing(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current)) event.preventDefault();
        }} />
    </label>
    {hasValue ? <button className={`icon-button ${styles.clear}`} type="button" aria-label={`清除${label}`} disabled={isComposing}
      onClick={() => {
        if (!input.current || composing.current) return;
        input.current.value = "";
        setHasValue(false);
        setError("");
        input.current.focus();
        input.current.form?.requestSubmit();
      }}><X aria-hidden="true" /></button> : null}</div>
    {error ? <p id={errorId} role="alert" className="form-error">{error}</p> : null}
  </div>;
}
