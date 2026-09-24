"use client";

import { useId, useState } from "react";
import type { DiaryObservations } from "@/lib/care-diary/schema";

const items = [
  { key: "meal", label: "本次進食量", choices: [["none", "未進食"], ["quarter", "約四分之一"], ["half", "約一半"], ["three_quarters", "約四分之三"], ["all", "全部"]] },
  { key: "water", label: "本次飲水量（毫升）", choices: [] },
  { key: "toileting", label: "本次如廁", choices: [["independent", "自行完成"], ["assisted", "協助完成"], ["not_needed", "當時無需求"], ["concern", "需留意，請補充摘要"]] },
  { key: "activity", label: "本次活動參與", choices: [["participated", "參與"], ["partial", "部分參與"], ["declined", "婉拒"], ["resting", "休息"]] },
] as const;

export function DiaryObservationsFields({ initial, restored }: { initial?: DiaryObservations; restored?: Record<string, string> }) {
  const prefix = useId();
  const [states, setStates] = useState<Record<string, string>>(() => Object.fromEntries(items.map(({ key }) => [key, restored?.[`${key}_state`] ?? initial?.[key].state ?? "unknown"])));
  return <fieldset className="core-dialog__fields"><legend>本次照顧快速紀錄（選填）</legend><p>只填這一次實際觀察；尚未觀察不等於正常，也不會自動沿用上次數值。</p>{items.map(({ key, label, choices }) => {
    const prior = initial?.[key];
    const value = restored?.[key] ?? (prior?.state === "observed" ? prior.value : "");
    return <div key={key} className="field"><label htmlFor={`${prefix}-${key}-state`}>{label}</label><select id={`${prefix}-${key}-state`} name={`${key}_state`} value={states[key]} onChange={(event) => setStates({ ...states, [key]: event.target.value })}><option value="unknown">尚未觀察／不清楚</option><option value="not_applicable">本次不適用</option><option value="observed">已有觀察，填寫結果</option></select>{states[key] === "observed" ? key === "water" ? <input aria-label={label} name={key} type="number" min={0} max={5000} step={1} required defaultValue={value} /> : <select aria-label={`${label}結果`} name={key} required defaultValue={String(value)}><option value="">請選擇實際結果</option>{choices.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select> : null}</div>;
  })}</fieldset>;
}
