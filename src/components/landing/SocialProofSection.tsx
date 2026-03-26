"use client";

import { useRef, useEffect, useState } from "react";
import AnimateOnScroll from "./AnimateOnScroll";
import { useCountUp } from "@/hooks/useCountUp";

const METRICS = [
    { end: 1000, suffix: "+", label: "기업 고객", duration: 2000 },
    { end: 50, suffix: "%", label: "업무 시간 절약", duration: 1600 },
    { end: 10, suffix: "초", label: "AI 응답 속도", duration: 1200 },
    { end: 99.9, suffix: "%", label: "가동률", duration: 2200, decimals: 1 },
];

function CountUpCard({
    end,
    suffix,
    label,
    duration,
    decimals = 0,
    delay,
}: {
    end: number;
    suffix: string;
    label: string;
    duration: number;
    decimals?: number;
    delay: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setTimeout(() => setInView(true), delay);
                    observer.unobserve(el);
                }
            },
            { threshold: 0.3 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [delay]);

    const value = useCountUp({ end, duration, start: inView, decimals });

    const formatted = decimals > 0 ? value.toFixed(decimals) : value.toLocaleString();

    return (
        <div
            ref={ref}
            className="text-center p-6 rounded-2xl bg-slate-50 border border-transparent hover:border-blue-100 transition-colors"
        >
            <div className="text-3xl font-bold text-blue-600 mb-2 tabular-nums">
                {formatted}
                {suffix}
            </div>
            <div className="text-slate-500 text-sm">{label}</div>
        </div>
    );
}

export default function SocialProofSection() {
    return (
        <section className="py-16 bg-white border-y border-slate-100">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                        {METRICS.map((m, i) => (
                            <CountUpCard
                                key={m.label}
                                end={m.end}
                                suffix={m.suffix}
                                label={m.label}
                                duration={m.duration}
                                decimals={m.decimals}
                                delay={i * 150}
                            />
                        ))}
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
