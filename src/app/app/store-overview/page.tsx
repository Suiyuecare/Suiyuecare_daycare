import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/auth/context";
import { loadStoreOverview } from "@/lib/store-overview/snapshot";
import { StoreOverviewWorkspace } from "@/components/store-overview/store-overview-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "單店出勤與收支" };

export default async function StoreOverviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireTenantContext("staff");
  const overview = await loadStoreOverview(context, await searchParams);
  if (!overview) notFound();
  return <StoreOverviewWorkspace overview={overview} />;
}
