import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { loadAttendanceMonth } from "@/lib/store-overview/attendance-month-snapshot";
import { AttendanceMonthWorkspace } from "@/components/store-overview/attendance-month-workspace";
export const dynamic = "force-dynamic";
export const metadata = { title: "出缺勤月報" };
export default async function AttendanceMonthPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext("staff");
  const snapshot = await loadAttendanceMonth(context, await searchParams);
  if (!snapshot) notFound();
  return <AttendanceMonthWorkspace snapshot={snapshot} />;
}
