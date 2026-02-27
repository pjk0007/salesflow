import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const PLANS = [
    {
        name: "Free",
        price: "무료",
        period: "",
        description: "소규모 팀을 위한 기본 플랜",
        features: [
            "워크스페이스 1개",
            "레코드 500건",
            "멤버 2명",
            "기본 대시보드",
            "이메일 발송",
        ],
        cta: "무료로 시작",
        highlighted: false,
    },
    {
        name: "Pro",
        price: "₩29,000",
        period: "/월",
        description: "성장하는 영업팀을 위한 플랜",
        features: [
            "워크스페이스 3개",
            "레코드 10,000건",
            "멤버 10명",
            "AI 도우미",
            "이메일/알림톡 자동화",
            "고급 대시보드",
        ],
        cta: "Pro 시작하기",
        highlighted: true,
    },
    {
        name: "Enterprise",
        price: "₩99,000",
        period: "/월",
        description: "대규모 조직을 위한 무제한 플랜",
        features: [
            "무제한 워크스페이스",
            "무제한 레코드",
            "무제한 멤버",
            "우선 지원",
            "전용 온보딩",
            "API 접근",
        ],
        cta: "문의하기",
        highlighted: false,
    },
];

export default function PricingSection() {
    return (
        <section id="pricing" className="py-20 px-4 bg-muted/30">
            <div className="container mx-auto">
                <AnimateOnScroll>
                    <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                        요금제
                    </h2>
                    <p className="mt-4 text-center text-muted-foreground">
                        팀 규모에 맞는 플랜을 선택하세요
                    </p>
                </AnimateOnScroll>
                <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3 max-w-5xl mx-auto">
                    {PLANS.map((plan, i) => (
                        <AnimateOnScroll key={plan.name} delay={i * 100}>
                            <div
                                className={`rounded-lg border bg-background p-6 flex flex-col h-full ${
                                    plan.highlighted
                                        ? "border-primary ring-2 ring-primary relative"
                                        : ""
                                }`}
                            >
                                {plan.highlighted && (
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                                        추천
                                    </span>
                                )}
                                <h3 className="text-lg font-semibold">{plan.name}</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {plan.description}
                                </p>
                                <div className="mt-4">
                                    <span className="text-3xl font-bold">{plan.price}</span>
                                    {plan.period && (
                                        <span className="text-muted-foreground">
                                            {plan.period}
                                        </span>
                                    )}
                                </div>
                                <ul className="mt-6 flex-1 space-y-2">
                                    {plan.features.map((feature) => (
                                        <li
                                            key={feature}
                                            className="flex items-center gap-2 text-sm"
                                        >
                                            <Check className="h-4 w-4 text-primary shrink-0" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    className="mt-6 w-full"
                                    variant={plan.highlighted ? "default" : "outline"}
                                    asChild
                                >
                                    <Link href="/signup">{plan.cta}</Link>
                                </Button>
                            </div>
                        </AnimateOnScroll>
                    ))}
                </div>
            </div>
        </section>
    );
}
