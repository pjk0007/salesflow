import "@/styles/globals.css";
import "@/styles/react-grid-layout.css";
import type { Metadata, Viewport } from "next";
import Providers from "./providers";

export const metadata: Metadata = {
    title: "SalesFlow",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ko" suppressHydrationWarning>
            <head>
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
