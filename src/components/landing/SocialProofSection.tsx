"use client";

import { useRef, useEffect, useState } from "react";
import { useCountUp } from "@/hooks/useCountUp";

const METRICS = [
    { end: 6, suffix: "가지", label: "AI 자동화 기능", duration: 1200 },
    { end: 3, suffix: "채널", label: "이메일 · 알림톡 · 웹폼", duration: 1400 },
    { end: 5, suffix: "분", label: "온보딩 소요 시간", duration: 1600 },
    { end: 24, suffix: "/7", label: "자동 발송 지원", duration: 1800 },
];

function CountUpCard({
    end,
    suffix,
    label,
    duration,
    decimals = 0,
    inView,
    delay,
}: {
    end: number;
    suffix: string;
    label: string;
    duration: number;
    decimals?: number;
    inView: boolean;
    delay: number;
}) {
    const [started, setStarted] = useState(false);

    useEffect(() => {
        if (!inView) return;
        const timer = setTimeout(() => setStarted(true), delay);
        return () => clearTimeout(timer);
    }, [inView, delay]);

    const value = useCountUp({ end, duration, start: started, decimals });
    const formatted = decimals > 0 ? value.toFixed(decimals) : value.toLocaleString();

    return (
        <div className="text-center p-6 rounded-2xl bg-slate-50 border border-transparent hover:border-blue-100 transition-colors">
            <div className="text-3xl font-bold text-blue-600 mb-2 tabular-nums">
                {formatted}
                {suffix}
            </div>
            <div className="text-slate-500 text-sm">{label}</div>
        </div>
    );
}

export default function SocialProofSection() {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setInView(true);
                    observer.unobserve(el);
                }
            },
            { threshold: 0.3 }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <section className="py-16 bg-white border-y border-slate-100">
            <div ref={ref} className="max-w-7xl mx-auto px-6 md:px-12">
                <div
                    className={`transition-all duration-700 ease-out ${
                        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                    }`}
                >
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                        {METRICS.map((m, i) => (
                            <CountUpCard
                                key={m.label}
                                end={m.end}
                                suffix={m.suffix}
                                label={m.label}
                                duration={m.duration}
                                decimals={0}
                                inView={inView}
                                delay={i * 150}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
