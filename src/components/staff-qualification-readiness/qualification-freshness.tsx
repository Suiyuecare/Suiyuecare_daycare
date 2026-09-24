"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCareTaipeiTime } from "@/lib/core-care/date";
import styles from "./qualification.module.css";

export function QualificationFreshness({ generatedAt, staleAfter }: { generatedAt: string; staleAfter: string }) {
  const [offline, setOffline] = useState(false);
  const [stale, setStale] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const update = () => { setOffline(!navigator.onLine); setStale(Date.now() >= Date.parse(staleAfter)); };
    update(); const timer = window.setInterval(update, 15_000);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.clearInterval(timer); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [staleAfter]);
  return <div className={`panel ${styles.freshness}`}><p role="status">更新時間：{formatCareTaipeiTime(generatedAt)}
    {offline ? " · 目前離線，顯示上次載入的內容。" : stale ? " · 這份清單已超過 5 分鐘，請更新後再處理。" : " · 資料以本次讀取為準。"}</p>
    <button type="button" className="button button--secondary" disabled={offline} onClick={() => router.refresh()}>重新讀取</button></div>;
}
