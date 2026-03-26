import AnimateOnScroll from "./AnimateOnScroll";

const STEPS = [
    { num: "1", title: "회원가입", description: "이메일로 간편하게\n계정을 만드세요." },
    { num: "2", title: "워크스페이스 설정", description: "팀원 초대 및 기본\n환경을 설정합니다." },
    { num: "3", title: "데이터 가져오기", description: "기존 고객 명단을\nCSV나 API로 연동하세요." },
    { num: "4", title: "분석 시작", description: "자동화 워크플로우를\n실행하고 결과를 확인하세요." },
];

export default function HowItWorksSection() {
    return (
        <section className="py-24 bg-white overflow-hidden">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">시작하는 법</h2>
                        <p className="text-slate-600">단 1분이면 영업 자동화 프로세스를 구축할 수 있습니다.</p>
                    </div>
                </AnimateOnScroll>

                <div className="relative grid md:grid-cols-4 gap-8">
                    {/* Connector line */}
                    <div className="hidden md:block absolute top-12 left-0 w-full h-0.5 bg-slate-100 z-0" />

                    {STEPS.map((s, i) => (
                        <AnimateOnScroll key={s.num} delay={i * 100}>
                            <div className="relative z-10 text-center space-y-4 group">
                                <div className="w-24 h-24 rounded-full bg-white border-4 border-blue-50 shadow-xl flex items-center justify-center mx-auto group-hover:border-blue-500 transition-colors">
                                    <span className="text-2xl font-extrabold text-blue-600">{s.num}</span>
                                </div>
                                <h4 className="font-bold text-slate-900">{s.title}</h4>
                                <p className="text-sm text-slate-500 whitespace-pre-line">{s.description}</p>
                            </div>
                        </AnimateOnScroll>
                    ))}
                </div>
            </div>
        </section>
    );
}
