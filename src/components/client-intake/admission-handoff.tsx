import Link from "next/link";
import type { IntakeSnapshot } from "@/lib/client-intake/model";
import styles from "./intake.module.css";

/** Navigation only. The destination reloads authorized lifecycle state by UUID. */
export function AdmissionHandoff({ snapshot, canRead, blocked }: {
  snapshot: IntakeSnapshot; canRead: boolean; blocked: boolean;
}) {
  if (!canRead) return null;
  return <section className={styles.selector} aria-label="接續正式收案">
    <div><h2>{snapshot.pending ? "下一步：確認正式收案" : "查看服務狀態與後續安排"}</h2>
      <p>{snapshot.pending ? "建檔與每週安排不代表已收案。請由授權人員確認文件、評估及服務開始日，再正式收案。" : "依正式收案、暫停及結案日期安排服務；本頁不會自動產生出勤或派車。"}</p>
      {blocked ? <p role="status">請先完成儲存並確認結果，再接續處理此個案。</p> : null}
    </div>
    {blocked ? <button className="button button--secondary" type="button" disabled>接續收案／服務狀態</button> :
      <Link className="button button--secondary" href={`/app/staff/operations/client-transitions?client=${encodeURIComponent(snapshot.clientId)}`} prefetch={false}>接續收案／服務狀態</Link>}
  </section>;
}
