import type { Metadata } from "next";

import { coreDailyMetadata, renderCoreDailyRoute } from "@/lib/core-care/daily-route";

const slug = "staff/daily-care/vital-signs";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return coreDailyMetadata(slug);
}

export default async function VitalSignsPage({ searchParams }: PageProps<"/app/staff/daily-care/vital-signs">) {
  return renderCoreDailyRoute(slug, await searchParams);
}
