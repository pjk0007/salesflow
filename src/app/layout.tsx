import "@/styles/globals.css";
import "@/styles/react-grid-layout.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sendb.app";

export const metadata: Metadata = {
    title: {
        default: "Sendb — 영업 자동화 플랫폼",
        template: "%s | Sendb",
    },
    description: "고객 관리, 이메일 자동화, AI 어시스턴트까지. Sendb로 영업 생산성을 극대화하세요.",
    keywords: ["CRM", "영업 자동화", "이메일 자동화", "AI 영업", "B2B", "고객 관리", "세일즈", "SaaS"],
    authors: [{ name: "Sendb" }],
    metadataBase: new URL(SITE_URL),
    openGraph: {
        type: "website",
        locale: "ko_KR",
        siteName: "Sendb",
        title: "Sendb — 영업 자동화 플랫폼",
        description: "고객 관리, 이메일 자동화, AI 어시스턴트까지. Sendb로 영업 생산성을 극대화하세요.",
        url: SITE_URL,
    },
    twitter: {
        card: "summary_large_image",
        title: "Sendb — 영업 자동화 플랫폼",
        description: "고객 관리, 이메일 자동화, AI 어시스턴트까지. Sendb로 영업 생산성을 극대화하세요.",
    },
    robots: {
        index: true,
        follow: true,
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ko" suppressHydrationWarning>
            <head>
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <link
                    rel="stylesheet"
                    as="style"
                    crossOrigin="anonymous"
                    href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
                />
            </head>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
