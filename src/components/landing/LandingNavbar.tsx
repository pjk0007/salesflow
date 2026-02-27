"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
    SheetTitle,
} from "@/components/ui/sheet";
import { Menu } from "lucide-react";

const NAV_LINKS = [
    { label: "기능", href: "#features" },
    { label: "요금", href: "#pricing" },
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
        <header
            className={`sticky top-0 z-50 w-full border-b backdrop-blur transition-shadow ${
                scrolled
                    ? "shadow-sm bg-background/95"
                    : "bg-background/80"
            }`}
        >
            <div className="container mx-auto flex h-14 items-center justify-between px-4">
                <Link href="/" className="text-xl font-bold">
                    SalesFlow
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden lg:flex items-center gap-6">
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                {/* Desktop CTA */}
                <div className="hidden lg:flex items-center gap-2">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/login">로그인</Link>
                    </Button>
                    <Button size="sm" asChild>
                        <Link href="/signup">무료로 시작하기</Link>
                    </Button>
                </div>

                {/* Mobile Menu */}
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild className="lg:hidden">
                        <Button variant="ghost" size="icon">
                            <Menu className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-72">
                        <SheetTitle className="text-lg font-bold">SalesFlow</SheetTitle>
                        <nav className="mt-6 flex flex-col gap-4">
                            {NAV_LINKS.map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setOpen(false)}
                                >
                                    {link.label}
                                </a>
                            ))}
                            <div className="mt-4 flex flex-col gap-2">
                                <Button variant="outline" asChild>
                                    <Link href="/login">로그인</Link>
                                </Button>
                                <Button asChild>
                                    <Link href="/signup">무료로 시작하기</Link>
                                </Button>
                            </div>
                        </nav>
                    </SheetContent>
                </Sheet>
            </div>
        </header>
    );
}
