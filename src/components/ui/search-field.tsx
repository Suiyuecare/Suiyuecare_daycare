"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./search-field.module.css";

type SearchFieldProps = {
  label: string; placeholder: string; name?: string; maxLength?: number;
  lengthUnit?: "code-points" | "code-units";
} & ({ mode?: "get"; defaultValue: string } | {
  mode: "local"; value: string; onValueChange: (value: string) => void;
});

/** GET is explicit; the local work-list variant only updates its controlled value. */
export function SearchField(props: SearchFieldProps) {
  const { label, placeholder, maxLength = 120 } = props;
  const lengthUnit = props.lengthUnit ?? (props.mode === "local" ? "code-units" : "code-points");
  const name = props.name ?? (props.mode === "local" ? undefined : "q");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [hasValue, setHasValue] = useState(props.mode === "local" ? Boolean(props.value) : Boolean(props.defaultValue));
  const [isComposing, setIsComposing] = useState(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => {
    if (props.mode === "local") return;
    const element = input.current;
    const form = element?.form;
    if (!form || !element) return;
    const validate = (event: Event) => {
      if (composing.current) { event.preventDefault(); return; }
      const length = lengthUnit === "code-units" ? element.value.length : [...element.value].length;
      if (length > maxLength) {
        event.preventDefault(); setError(lengthUnit === "code-units" ? "搜尋文字過長，請縮短後再試。" : `請輸入 ${maxLength} 字以內的搜尋文字。`); element.focus();
      }
    };
    form.addEventListener("submit", validate);
    return () => form.removeEventListener("submit", validate);
  }, [maxLength, props.mode, lengthUnit]);
  const showClear = props.mode === "local" ? Boolean(compositionDraft ?? props.value) : hasValue;
  return <div className={`filter-search ${styles.search}`}>
    <div className={styles.control}><label><Search aria-hidden="true" /><span className="sr-only">{label}</span>
      <input ref={input} name={name} type="search" autoComplete="off"
        {...(props.mode === "local" ? { value: compositionDraft ?? props.value } : { defaultValue: props.defaultValue })}
        maxLength={lengthUnit === "code-units" ? maxLength : maxLength * 2} placeholder={placeholder} aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          if (props.mode === "local") {
            if (composing.current) setCompositionDraft(event.target.value);
            else props.onValueChange(event.target.value);
          }
          else setHasValue(Boolean(event.target.value));
          setError("");
        }}
        onCompositionStart={() => { composing.current = true; setIsComposing(true); }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setIsComposing(false);
          if (props.mode === "local") {
            if (event.currentTarget.value !== props.value) props.onValueChange(event.currentTarget.value);
            setCompositionDraft(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current)) event.preventDefault();
        }} />
    </label>
    {showClear ? <button className={`icon-button ${styles.clear}`} type="button" aria-label={`清除${label}`} disabled={isComposing}
      onClick={() => {
        if (!input.current || composing.current) return;
        if (props.mode === "local") props.onValueChange("");
        else { input.current.value = ""; setHasValue(false); }
        setError("");
        input.current.focus();
        if (props.mode !== "local") input.current.form?.requestSubmit();
      }}><X aria-hidden="true" /></button> : null}</div>
    {error ? <p id={errorId} role="alert" className="form-error">{error}</p> : null}
  </div>;
}
