"use client";

import { Toaster } from "sonner";
import { ThemeProvider } from "next-themes";
import { SessionProvider } from "@/contexts/SessionContext";

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                {children}
                <Toaster position="top-right" richColors />
            </ThemeProvider>
        </SessionProvider>
    );
}
