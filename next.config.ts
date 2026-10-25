import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    // Keep server.js at .next/standalone even when a parent folder has another lockfile.
    outputFileTracingRoot: __dirname,
    reactCompiler: true,
    reactStrictMode: true,
    images: {
        unoptimized: true,
    },
    serverExternalPackages: [],
    experimental: {
        serverActions: {
            bodySizeLimit: "10mb",
        },
    },
    async headers() {
        return [
            {
                source: "/sign/:token*",
                headers: [
                    { key: "Referrer-Policy", value: "no-referrer" },
                    { key: "X-Robots-Tag", value: "noindex, nofollow" },
                    { key: "Cache-Control", value: "no-store" },
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
                ],
            },
            {
                // 공개 웹 폼(/f/[slug])은 고객 사이트에 iframe으로 넣는다 — 표준 CSP frame-ancestors로만 허용한다 (UX-053)
                source: "/f/:slug*",
                headers: [
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors *",
                    },
                ],
            },
        ];
    },
};

export default nextConfig;
