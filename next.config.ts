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
                source: "/forms/:slug*",
                headers: [
                    {
                        key: "X-Frame-Options",
                        value: "ALLOWALL",
                    },
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
