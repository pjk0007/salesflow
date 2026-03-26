import AnimateOnScroll from "./AnimateOnScroll";

const METRICS = [
    { value: "1,000+", label: "기업 고객" },
    { value: "50%", label: "업무 시간 절약" },
    { value: "10초", label: "AI 응답 속도" },
    { value: "99.9%", label: "가동률" },
];

export default function SocialProofSection() {
    return (
        <section className="py-16 bg-white border-y border-slate-100">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                        {METRICS.map((m) => (
                            <div key={m.label}
                                className="text-center p-6 rounded-2xl bg-slate-50 border border-transparent hover:border-blue-100 transition-colors">
                                <div className="text-3xl font-bold text-blue-600 mb-2">{m.value}</div>
                                <div className="text-slate-500 text-sm">{m.label}</div>
                            </div>
                        ))}
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
