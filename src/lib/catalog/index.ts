import { familyPages } from "./family-pages";
import { catalogModules } from "./modules";
import { staffPages } from "./staff-pages";
import type {
  CatalogModule,
  CatalogSurface,
  ModuleId,
  NavigationGroup,
  PageCatalogEntry,
} from "./types";

export * from "./types";
export { canAccessCatalogPage, filterNavigationByAccess } from "./access";
export { catalogModules, familyPages, staffPages };

export const pageCatalog: readonly PageCatalogEntry[] = Object.freeze([
  ...staffPages,
  ...familyPages,
]);

export const parityPages = pageCatalog.filter((page) => page.origin === "parity");
export const addedPages = pageCatalog.filter((page) => page.origin !== "parity");

const pageBySlug = new Map(pageCatalog.map((page) => [page.slug, page]));
const moduleById = new Map<ModuleId, CatalogModule>(
  catalogModules.map((module) => [module.id, module]),
);

function normalizeSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, "");
}

/** Find a catalog page using its stable slug, with or without a leading slash. */
export function getPageBySlug(slug: string): PageCatalogEntry | undefined {
  return pageBySlug.get(normalizeSlug(slug));
}

export function getModule(moduleId: ModuleId): CatalogModule {
  const catalogModule = moduleById.get(moduleId);
  if (!catalogModule) {
    throw new Error(`Unknown catalog module: ${moduleId}`);
  }
  return catalogModule;
}

/** Build navigation in the approved module and page order. */
export function getNavigationGroups(
  surface?: CatalogSurface,
): readonly NavigationGroup[] {
  return catalogModules
    .filter((catalogModule) => !surface || catalogModule.surface === surface)
    .map((catalogModule) => ({
      ...catalogModule,
      pages: pageCatalog
        .filter((page) => page.moduleId === catalogModule.id)
        .sort((a, b) => a.number - b.number),
    }));
}

export const staffNavigationGroups = getNavigationGroups("staff");
export const familyNavigationGroups = getNavigationGroups("family");

export const catalogSummary = Object.freeze({
  moduleCount: catalogModules.length,
  pageCount: pageCatalog.length,
  staffPageCount: staffPages.length,
  familyPageCount: familyPages.length,
  parityPageCount: parityPages.length,
  addedPageCount: addedPages.length,
});
