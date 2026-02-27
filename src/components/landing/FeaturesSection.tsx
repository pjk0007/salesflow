import { Users, BarChart3, Mail, Sparkles } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const FEATURES = [
    {
        icon: Users,
        title: "고객 관리",
        description:
            "고객 정보를 체계적으로 관리하고 영업 기회를 놓치지 마세요. 커스텀 필드로 나만의 CRM을 만들 수 있습니다.",
    },
    {
        icon: BarChart3,
        title: "대시보드",
        description:
            "실시간 데이터 시각화로 영업 현황을 한눈에 파악하세요. 드래그 앤 드롭으로 위젯을 자유롭게 배치할 수 있습니다.",
    },
    {
        icon: Mail,
        title: "자동화",
        description:
            "이메일과 알림톡을 자동으로 발송하고 업무 효율을 높이세요. 조건 기반 자동 발송으로 반복 업무를 줄입니다.",
    },
    {
        icon: Sparkles,
        title: "AI 도우미",
        description:
            "AI가 이메일 작성, 기업 조사, 대시보드 설계를 도와줍니다. 자연어로 요청하면 AI가 설정을 추천합니다.",
    },
];

export default function FeaturesSection() {
    return (
        <section id="features" className="py-20 px-4">
            <div className="container mx-auto">
                <AnimateOnScroll>
                    <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                        주요 기능
                    </h2>
                    <p className="mt-4 text-center text-muted-foreground">
                        영업팀에 필요한 모든 도구를 하나의 플랫폼에서
                    </p>
                </AnimateOnScroll>
                <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {FEATURES.map((feature, i) => (
                        <AnimateOnScroll key={feature.title} delay={i * 100}>
                            <div className="rounded-lg border p-6 transition-all hover:shadow-lg hover:-translate-y-1">
                                <div className="rounded-lg bg-primary/10 p-2.5 w-fit">
                                    <feature.icon className="h-6 w-6 text-primary" />
                                </div>
                                <h3 className="mt-4 text-lg font-semibold">
                                    {feature.title}
                                </h3>
                                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        </AnimateOnScroll>
                    ))}
                </div>
            </div>
        </section>
    );
}
