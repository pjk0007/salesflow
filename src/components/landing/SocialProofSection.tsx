import { Building2, Clock, Zap, Shield, Star } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const METRICS = [
    { icon: Building2, value: "1,000+", label: "고객사" },
    { icon: Clock, value: "50%", label: "업무 시간 절감" },
    { icon: Zap, value: "10초", label: "AI 분석 응답" },
    { icon: Shield, value: "99.9%", label: "서비스 가동률" },
];

const TESTIMONIALS = [
    {
        name: "김태현",
        title: "영업팀장",
        company: "넥스트커머스",
        quote: "고객 관리에 쏟던 시간이 절반으로 줄었습니다. 이메일 자동화가 특히 유용해요.",
    },
    {
        name: "이수진",
        title: "대표이사",
        company: "디지털솔루션즈",
        quote: "AI 도우미 덕분에 기업 조사와 이메일 작성이 훨씬 빨라졌습니다.",
    },
    {
        name: "박준영",
        title: "세일즈 매니저",
        company: "클라우드웍스",
        quote: "대시보드 하나로 팀 전체의 영업 현황을 실시간으로 파악할 수 있어요.",
    },
    {
        name: "최민지",
        title: "마케팅 디렉터",
        company: "그로스랩",
        quote: "알림톡 자동화로 고객 응대 속도가 확 올라갔습니다. 강추합니다.",
    },
    {
        name: "장서연",
        title: "COO",
        company: "테크브릿지",
        quote: "커스텀 필드와 파이프라인 덕분에 우리 팀에 딱 맞는 CRM이 되었어요.",
    },
    {
        name: "한동우",
        title: "영업 담당",
        company: "스마트비즈",
        quote: "웹폼으로 리드 수집하고 바로 영업으로 연결되니 전환율이 높아졌습니다.",
    },
];

function TestimonialCard({ name, title, company, quote }: (typeof TESTIMONIALS)[number]) {
    return (
        <div className="min-w-[300px] rounded-xl border bg-background p-5 shrink-0">
            <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                &ldquo;{quote}&rdquo;
            </p>
            <div className="mt-4">
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{title}, {company}</p>
            </div>
        </div>
    );
}

export default function SocialProofSection() {
    return (
        <section className="py-16 bg-muted/30">
            <div className="container mx-auto px-4">
                {/* Metrics */}
                <AnimateOnScroll>
                    <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                        {METRICS.map((m) => (
                            <div key={m.label} className="flex flex-col items-center text-center gap-2">
                                <div className="rounded-full bg-primary/10 p-3">
                                    <m.icon className="h-5 w-5 text-primary" />
                                </div>
                                <p className="text-2xl font-bold sm:text-3xl">{m.value}</p>
                                <p className="text-sm text-muted-foreground">{m.label}</p>
                            </div>
                        ))}
                    </div>
                </AnimateOnScroll>

                <div className="border-t my-12" />

                {/* Testimonials Marquee */}
                <AnimateOnScroll>
                    <div className="relative overflow-hidden">
                        {/* Gradient masks */}
                        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-muted/30 to-transparent" />
                        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-muted/30 to-transparent" />

                        <div className="flex gap-4 animate-marquee hover:[animation-play-state:paused]">
                            {TESTIMONIALS.map((t) => (
                                <TestimonialCard key={t.name} {...t} />
                            ))}
                            {/* Duplicate for seamless loop */}
                            {TESTIMONIALS.map((t) => (
                                <TestimonialCard key={`dup-${t.name}`} {...t} />
                            ))}
                        </div>
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
