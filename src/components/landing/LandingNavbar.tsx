"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SendbIcon } from "@/components/SendbLogo";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
    SheetTitle,
} from "@/components/ui/sheet";
import { Menu } from "lucide-react";

const NAV_LINKS = [
    { label: "기능", href: "#features" },
    { label: "요금제", href: "#pricing" },
    { label: "FAQ", href: "#faq" },
];

export default function LandingNavbar() {
    const [scrolled, setScrolled] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 50);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <nav className={`fixed top-0 w-full z-50 backdrop-blur-md border-b transition-all ${
            scrolled ? "bg-white/95 shadow-sm border-slate-200/50" : "bg-white/80 border-transparent"
        }`}>
            <div className="flex justify-between items-center px-6 md:px-12 py-4 max-w-7xl mx-auto">
                <div className="flex items-center gap-8">
                    <Link href="/" className="flex items-center gap-2">
                        <SendbIcon className="size-7" />
                        <span className="text-xl font-bold bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">Sendb</span>
                    </Link>
                    <div className="hidden md:flex items-center gap-6">
                        {NAV_LINKS.map((link) => (
                            <a key={link.href} href={link.href}
                                className="text-slate-600 hover:text-blue-600 text-sm font-medium transition-colors">
                                {link.label}
                            </a>
                        ))}
                    </div>
                </div>

                <div className="hidden md:flex items-center gap-4">
                    <Link href="/login" className="text-slate-600 hover:text-blue-600 text-sm font-medium transition-colors">
                        로그인
                    </Link>
                    <Link href="/signup"
                        className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-blue-700 transition-all shadow-md active:opacity-90">
                        무료로 시작하기
                    </Link>
                </div>

                {/* Mobile */}
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild className="md:hidden">
                        <button className="p-2 text-slate-600"><Menu className="h-5 w-5" /></button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-72">
                        <SheetTitle className="flex items-center gap-2 text-lg font-bold"><SendbIcon className="size-5" />Sendb</SheetTitle>
                        <nav className="mt-6 flex flex-col gap-4">
                            {NAV_LINKS.map((link) => (
                                <a key={link.href} href={link.href}
                                    className="text-sm text-slate-600 hover:text-blue-600 transition-colors"
                                    onClick={() => setOpen(false)}>
                                    {link.label}
                                </a>
                            ))}
                            <div className="mt-4 flex flex-col gap-2">
                                <Link href="/login" className="text-center py-2.5 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50">로그인</Link>
                                <Link href="/signup" className="text-center py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">무료로 시작하기</Link>
                            </div>
                        </nav>
                    </SheetContent>
                </Sheet>
            </div>
        </nav>
    );
}
