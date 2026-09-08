import type { Metadata } from "next";
import "./globals.css";

import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { appBranding } from "@/lib/config/branding";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000",
  ),
  title: {
    default: appBranding.applicationName,
    template: `%s｜${appBranding.applicationName}`,
  },
  description: "為社區式日間照顧團隊設計的工作、照顧與家屬溝通平台。",
  applicationName: appBranding.applicationName,
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>
        <a className="skip-link" href="#main-content">
          跳至主要內容
        </a>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
