import "@/styles/globals.css";
import "@/styles/react-grid-layout.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";
import { SessionProvider } from "@/contexts/SessionContext";

export default function App({ Component, pageProps }: AppProps) {
    return (
        <SessionProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <Head>
                    <title>SalesFlow</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                </Head>
                <Component {...pageProps} />
                <Toaster position="top-right" richColors />
            </ThemeProvider>
        </SessionProvider>
    );
}
