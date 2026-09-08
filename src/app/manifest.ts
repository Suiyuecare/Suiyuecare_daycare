import type { MetadataRoute } from "next";
import { appBranding } from "@/lib/config/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appBranding.applicationName,
    short_name: appBranding.shortName,
    description: "社區式日間照顧工作與家屬溝通平台",
    start_url: "/app/dashboard",
    display: "standalone",
    background_color: "#f6f3eb",
    theme_color: "#1f6b5f",
    lang: "zh-Hant",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
