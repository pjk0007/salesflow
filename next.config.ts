import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
