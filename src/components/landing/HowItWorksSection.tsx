import { UserPlus, Settings, Upload, TrendingUp } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const STEPS = [
    { icon: UserPlus, step: "STEP 1", title: "회원가입", description: "이메일만으로 30초면 완료" },
    { icon: Settings, step: "STEP 2", title: "워크스페이스 설정", description: "팀에 맞는 필드와 파이프라인 구성" },
    { icon: Upload, step: "STEP 3", title: "데이터 등록", description: "기존 고객 데이터 CSV 가져오기" },
    { icon: TrendingUp, step: "STEP 4", title: "분석 시작", description: "AI 대시보드로 인사이트 확인" },
];

export default function HowItWorksSection() {
    return (
        <section className="py-20 px-4">
            <div className="container mx-auto">
                <AnimateOnScroll>
                    <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                        시작하기 쉬워요
                    </h2>
                    <p className="mt-4 text-center text-muted-foreground">
                        4단계만 거치면 바로 사용할 수 있습니다
                    </p>
                </AnimateOnScroll>

                <div className="mt-12 relative">
                    {/* Connector line (desktop only) */}
                    <div className="hidden lg:block absolute top-16 left-[12.5%] right-[12.5%] border-t border-dashed border-muted-foreground/30" />

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                        {STEPS.map((s, i) => (
                            <AnimateOnScroll key={s.step} delay={i * 100}>
                                <div className="flex flex-col items-center text-center relative">
                                    <p className="text-xs font-bold text-primary mb-2">{s.step}</p>
                                    <div className="rounded-full bg-primary/10 p-4">
                                        <s.icon className="h-6 w-6 text-primary" />
                                    </div>
                                    <h3 className="mt-4 font-semibold">{s.title}</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                                </div>
                            </AnimateOnScroll>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
