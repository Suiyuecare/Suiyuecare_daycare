export type CatalogSurface = "staff" | "family";

export type PageOrigin = "parity" | "governance" | "family";

export type RiskLevel = "standard" | "sensitive" | "high";

export type OfflineMode = "online-only" | "read-cache-24h" | "draft-sync-24h";

export type ModuleId =
  | "workspace"
  | "daily-care"
  | "assessments"
  | "quality"
  | "social-work"
  | "professional-care"
  | "communication"
  | "service-management"
  | "operations"
  | "governance"
  | "family-portal";

export interface OfflinePolicy {
  mode: OfflineMode;
  /** Human-readable boundary shown in help and review screens. */
  note: string;
}

export interface PageCatalogEntry {
  /** Stable number from the approved 89-page specification. */
  number: number;
  /** Stable, globally unique route slug without a leading slash. */
  slug: string;
  moduleId: ModuleId;
  surface: CatalogSurface;
  origin: PageOrigin;
  title: string;
  description: string;
  primaryActions: readonly string[];
  filters: readonly string[];
  metrics: readonly string[];
  columns: readonly string[];
  acceptance: readonly string[];
  /**
   * Permissions required to open this page in production. Every listed
   * permission is required. An empty list means that page access is governed
   * by the authenticated staff/client data scope alone.
   */
  requiredPermissions: readonly string[];
  riskLevel: RiskLevel;
  offline: OfflinePolicy;
}

export interface CatalogModule {
  id: ModuleId;
  title: string;
  description: string;
  surface: CatalogSurface;
  order: number;
}

export interface NavigationGroup extends CatalogModule {
  pages: readonly PageCatalogEntry[];
}
