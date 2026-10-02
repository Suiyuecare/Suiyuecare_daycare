import type { Metadata } from "next";

import { coreDailyMetadata, renderCoreDailyRoute } from "@/lib/core-care/daily-route";

const slug = "staff/daily-care/care-diary";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return coreDailyMetadata(slug);
}

export default async function CareDiaryPage({ searchParams }: PageProps<"/app/staff/daily-care/care-diary">) {
  return renderCoreDailyRoute(slug, await searchParams);
}
