import Link from "next/link";
import { Check } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const PLANS = [
    {
        name: "Free",
        price: "₩0",
        period: "/월",
        features: ["워크스페이스 1개", "레코드 500건", "멤버 2명", "이메일/알림톡 발송"],
        cta: "무료로 시작하기",
        highlighted: false,
    },
    {
        name: "Pro",
        price: "₩29,000",
        period: "/월",
        features: ["워크스페이스 3개", "레코드 10,000건", "AI 이메일 어시스턴트", "이메일/알림톡 자동화", "우선 기술 지원"],
        cta: "지금 바로 시작",
        highlighted: true,
    },
    {
        name: "Enterprise",
        price: "₩99,000",
        period: "/월",
        features: ["Pro의 모든 기능 포함", "무제한 워크스페이스", "무제한 레코드", "외부 REST API 연동", "멤버 무제한"],
        cta: "영업팀에 문의",
        highlighted: false,
    },
];

export default function PricingSection() {
    return (
        <section id="pricing" className="py-24 bg-slate-50">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">투명한 가격 정책</h2>
                        <p className="text-slate-600">비즈니스 규모에 맞는 최적의 플랜을 선택하세요.</p>
                    </div>
                </AnimateOnScroll>

                <div className="grid md:grid-cols-3 gap-8 items-stretch">
                    {PLANS.map((plan, i) => (
                        <AnimateOnScroll key={plan.name} delay={i * 100}>
                            {plan.highlighted ? (
                                <div className="bg-blue-600 rounded-3xl p-8 text-white flex flex-col shadow-2xl shadow-blue-200 transform md:scale-105 relative z-10 h-full">
                                    <div className="absolute top-0 right-8 -translate-y-1/2 bg-violet-500 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                                        추천
                                    </div>
                                    <div className="mb-8">
                                        <h3 className="text-lg font-bold mb-2">{plan.name}</h3>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-4xl font-extrabold">{plan.price}</span>
                                            <span className="text-blue-100">{plan.period}</span>
                                        </div>
                                    </div>
                                    <ul className="space-y-4 mb-8 flex-grow text-blue-50 text-sm">
                                        {plan.features.map((f) => (
                                            <li key={f} className="flex items-center gap-3">
                                                <Check className="h-4 w-4 text-blue-200 shrink-0" />{f}
                                            </li>
                                        ))}
                                    </ul>
                                    <Link href="/signup"
                                        className="w-full py-4 px-6 rounded-xl bg-white text-blue-600 font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all text-center block">
                                        {plan.cta}
                                    </Link>
                                </div>
                            ) : (
                                <div className="bg-white rounded-3xl p-8 border border-slate-200 flex flex-col hover:shadow-xl transition-shadow h-full">
                                    <div className="mb-8">
                                        <h3 className="text-lg font-bold text-slate-900 mb-2">{plan.name}</h3>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-4xl font-extrabold">{plan.price}</span>
                                            <span className="text-slate-500">{plan.period}</span>
                                        </div>
                                    </div>
                                    <ul className="space-y-4 mb-8 flex-grow text-slate-600 text-sm">
                                        {plan.features.map((f) => (
                                            <li key={f} className="flex items-center gap-3">
                                                <Check className="h-4 w-4 text-emerald-500 shrink-0" />{f}
                                            </li>
                                        ))}
                                    </ul>
                                    <Link href="/signup"
                                        className="w-full py-3 px-6 rounded-xl border border-slate-200 font-bold hover:bg-slate-50 transition-all text-center block">
                                        {plan.cta}
                                    </Link>
                                </div>
                            )}
                        </AnimateOnScroll>
                    ))}
                </div>
            </div>
        </section>
    );
}
