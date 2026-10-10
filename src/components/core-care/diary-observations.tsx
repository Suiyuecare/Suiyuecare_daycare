"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DiaryObservations } from "@/lib/care-diary/schema";

const items = [
  { key: "meal", label: "本次進食量", choices: [["none", "未進食"], ["quarter", "約四分之一"], ["half", "約一半"], ["three_quarters", "約四分之三"], ["all", "全部"]] },
  { key: "water", label: "本次飲水量（毫升）", choices: [] },
  { key: "toileting", label: "本次如廁", choices: [["independent", "自行完成"], ["assisted", "協助完成"], ["not_needed", "當時無需求"], ["concern", "需留意，請補充摘要"]] },
  { key: "activity", label: "本次活動參與", choices: [["participated", "參與"], ["partial", "部分參與"], ["declined", "婉拒"], ["resting", "休息"]] },
] as const;

export function DiaryObservationsFields({ initial, restored, caregiverMode = false, onUserChange }: { initial?: DiaryObservations; restored?: Record<string, string>; caregiverMode?: boolean; onUserChange?: () => void }) {
  const prefix = useId();
  const [states, setStates] = useState<Record<string, string>>(() => Object.fromEntries(items.map(({ key }) => [key, restored?.[`${key}_state`] ?? initial?.[key].state ?? "unknown"])));
  const [results, setResults] = useState<Record<string, string>>(() => Object.fromEntries(items.map(({ key }) => [key, restored?.[key] ?? (initial?.[key].state === "observed" ? String(initial[key].value) : "")])));
  const changedByUser = useRef(false);
  useEffect(() => {
    if (!changedByUser.current) return;
    changedByUser.current = false;
    onUserChange?.();
  }, [states, results, onUserChange]);
  function choose(key: string, state: "observed" | "unknown" | "not_applicable", result = "") {
    changedByUser.current = true;
    setStates((current) => ({ ...current, [key]: state }));
    setResults((current) => ({ ...current, [key]: state === "observed" ? result : "" }));
  }
  function legacyItem({ key, label, choices }: typeof items[number]) {
    const prior = initial?.[key];
    const value = restored?.[key] ?? (prior?.state === "observed" ? prior.value : "");
    return <div key={key} className="field"><label htmlFor={`${prefix}-${key}-state`}>{label}</label><select id={`${prefix}-${key}-state`} name={`${key}_state`} value={states[key]} onChange={(event) => setStates((current) => ({ ...current, [key]: event.target.value }))}><option value="unknown">尚未觀察／不清楚</option><option value="not_applicable">本次不適用</option><option value="observed">已有觀察，填寫結果</option></select>{states[key] === "observed" ? key === "water" ? <input aria-label={label} name={key} type="number" min={0} max={5000} step={1} required defaultValue={value} /> : <select aria-label={`${label}結果`} name={key} required defaultValue={String(value)}><option value="">請選擇實際結果</option>{choices.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select> : null}</div>;
  }
  if (!caregiverMode) return <fieldset className="core-dialog__fields"><legend>本次照顧快速紀錄（選填）</legend><p>只填這一次實際觀察；尚未觀察不等於正常，也不會自動沿用上次數值。</p>{items.map(legacyItem)}</fieldset>;
  return <fieldset className="core-dialog__fields caregiver-observations"><legend>本次觀察（選填）</legend><p>只記錄實際觀察；空白不代表 0。</p>
    <div className="caregiver-observations__item">
      <label htmlFor={`${prefix}-water`}>{items[1].label}</label>
      <div className="caregiver-observations__water"><input id={`${prefix}-water`} inputMode="numeric" max={5000} min={0} name="water" onChange={(event) => choose("water", event.target.value === "" ? "unknown" : "observed", event.target.value)} placeholder="輸入毫升，例如 120" step={1} type="number" value={results.water} disabled={states.water === "not_applicable"} /><span aria-hidden="true">mL</span></div>
      <div aria-label="飲水量狀態" className="caregiver-observations__choices" role="group">
        <button aria-pressed={states.water === "unknown"} className="caregiver-observations__choice" onClick={() => choose("water", "unknown")} type="button">未觀察</button>
        <button aria-pressed={states.water === "not_applicable"} className="caregiver-observations__choice" onClick={() => choose("water", "not_applicable")} type="button">不適用</button>
      </div>
      <select aria-hidden="true" hidden name="water_state" onChange={() => {}} tabIndex={-1} value={states.water}><option value="unknown">未觀察</option><option value="not_applicable">不適用</option><option value="observed">已觀察</option></select>
    </div>
    {[items[2], items[3]].map(({ key, label, choices }) => <div className="caregiver-observations__item" key={key}>
      <strong id={`${prefix}-${key}-label`}>{label}</strong>
      <div aria-labelledby={`${prefix}-${key}-label`} className="caregiver-observations__choices" role="group">
        {choices.map(([option, text]) => <button aria-pressed={states[key] === "observed" && results[key] === option} className="caregiver-observations__choice" key={option} onClick={() => choose(key, "observed", option)} type="button">{text}</button>)}
        <button aria-pressed={states[key] === "unknown"} className="caregiver-observations__choice" onClick={() => choose(key, "unknown")} type="button">未觀察</button>
        <button aria-pressed={states[key] === "not_applicable"} className="caregiver-observations__choice" onClick={() => choose(key, "not_applicable")} type="button">不適用</button>
      </div>
      <select aria-hidden="true" hidden name={`${key}_state`} onChange={() => {}} tabIndex={-1} value={states[key]}><option value="unknown">未觀察</option><option value="not_applicable">不適用</option><option value="observed">已觀察</option></select>
      <select aria-hidden="true" hidden name={key} onChange={() => {}} tabIndex={-1} value={results[key]}><option value="">未填</option>{choices.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select>
    </div>)}
    <details className="caregiver-observations__more"><summary>其他觀察：進食量</summary>{legacyItem(items[0])}</details>
  </fieldset>;
}
