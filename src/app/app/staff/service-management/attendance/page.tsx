import type { Metadata } from "next";

import { coreDailyMetadata, renderCoreDailyRoute } from "@/lib/core-care/daily-route";

const slug = "staff/service-management/attendance";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return coreDailyMetadata(slug);
}

export default async function AttendancePage({ searchParams }: PageProps<"/app/staff/service-management/attendance">) {
  return renderCoreDailyRoute(slug, await searchParams);
}
