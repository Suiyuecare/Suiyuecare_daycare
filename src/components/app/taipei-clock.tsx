"use client";

import { useEffect, useState } from "react";

const clockFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** Keep the Finance-style clock live without re-rendering navigation each second. */
export function TaipeiClock() {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const update = () => setClock(clockFormatter.format(new Date()));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <time className="topbar__clock" dateTime={clock ? `${clock}+08:00` : undefined}>
    <span className="sr-only">台北時間 </span>{clock || "--:--:--"}
  </time>;
}
