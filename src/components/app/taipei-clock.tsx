"use client";

import { useEffect, useState } from "react";

const formatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function TaipeiClock() {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const update = () => setClock(formatter.format(new Date()));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <time
    aria-label={clock ? `台北時間 ${clock}` : "台北時間載入中"}
    className="topbar__clock"
    dateTime={clock ? `${clock}+08:00` : undefined}
  >{clock || "--:--:--"}</time>;
}
