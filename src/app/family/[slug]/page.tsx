import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FamilyHome } from "@/components/family/family-home";
import { FamilyWorkspace } from "@/components/family/family-workspace";
import { requireTenantContext } from "@/lib/auth/context";
import { familyPages, getPageBySlug } from "@/lib/catalog";
import { loadFamilyPortalSnapshot } from "@/lib/family/snapshot";

export function generateStaticParams() {
  return familyPages.map((page) => ({ slug: page.slug.replace(/^family\//, "") }));
}

export async function generateMetadata({ params }: PageProps<"/family/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = getPageBySlug(`family/${slug}`);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function FamilyPage({ params, searchParams }: PageProps<"/family/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;
  const selectedClient = typeof query.client === "string" ? query.client : undefined;
  const page = getPageBySlug(`family/${slug}`);
  if (!page || page.surface !== "family") notFound();
  const context = await requireTenantContext("family");
  const snapshot = await loadFamilyPortalSnapshot(context.organizationId, context.branchId, selectedClient);
  return page.number === 84
    ? <FamilyHome branchName={context.branchName} demo={context.demo} snapshot={snapshot} />
    : <FamilyWorkspace demo={context.demo} page={page} snapshot={snapshot} />;
}
