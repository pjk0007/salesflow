import { Users, Mail, MessageSquare, Sparkles, Check } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

export default function FeaturesSection() {
    return (
        <section id="features" className="py-24 bg-slate-50">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6 tracking-tight">
                            강력한 기능으로 영업을 자동화하세요
                        </h2>
                        <p className="text-slate-600">
                            수작업을 줄이고 성과를 높이는 Sendb만의 핵심 도구들을 만나보세요.
                        </p>
                    </div>
                </AnimateOnScroll>

                {/* Bento Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* CRM — large */}
                    <AnimateOnScroll className="lg:col-span-8 bg-white rounded-3xl p-8 border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row gap-8 items-center group">
                        <div className="md:w-1/2 space-y-4">
                            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                                <Users className="h-6 w-6" />
                            </div>
                            <h3 className="text-2xl font-bold text-slate-900">고객 관리 CRM</h3>
                            <p className="text-slate-600 leading-relaxed">
                                모든 연락처와 고객 정보를 한 눈에 확인하세요. 커스텀 필드로 팀에 맞는 CRM을 구성할 수 있습니다.
                            </p>
                        </div>
                        <div className="md:w-1/2 rounded-xl border border-slate-100 overflow-hidden">
                            <div className="text-[11px]">
                                <div className="grid grid-cols-3 gap-2 border-b px-3 py-2 font-medium text-slate-400 bg-slate-50">
                                    <span>이름</span><span>회사</span><span>상태</span>
                                </div>
                                {[
                                    { name: "김민수", company: "테크코리아", status: "활성", color: "bg-green-100 text-green-700" },
                                    { name: "이서연", company: "그린에너지", status: "잠재", color: "bg-blue-100 text-blue-700" },
                                    { name: "박지훈", company: "스마트물류", status: "활성", color: "bg-green-100 text-green-700" },
                                ].map((r) => (
                                    <div key={r.name} className="grid grid-cols-3 gap-2 px-3 py-2.5 border-b border-slate-50">
                                        <span className="font-medium text-slate-900">{r.name}</span>
                                        <span className="text-slate-500">{r.company}</span>
                                        <span><span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${r.color}`}>{r.status}</span></span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </AnimateOnScroll>

                    {/* Email — blue card */}
                    <AnimateOnScroll delay={100} className="lg:col-span-4 bg-blue-600 rounded-3xl p-8 text-white flex flex-col justify-between group">
                        <div className="space-y-4">
                            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                                <Mail className="h-6 w-6 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold">이메일 자동화</h3>
                            <p className="text-blue-100">개인화된 시퀀스로 리드에게 자동으로 이메일을 전송하고 성과를 분석하세요.</p>
                        </div>
                        <div className="mt-8 flex items-end gap-1.5 h-20">
                            {[30, 50, 40, 70, 55, 85, 65].map((h, i) => (
                                <div key={i} className="flex-1 rounded-t-sm bg-white/20 group-hover:bg-white/30 transition-colors" style={{ height: `${h}%` }} />
                            ))}
                        </div>
                    </AnimateOnScroll>

                    {/* Alimtalk — medium */}
                    <AnimateOnScroll delay={200} className="lg:col-span-5 bg-white rounded-3xl p-8 border border-slate-200 shadow-sm flex flex-col justify-between group">
                        <div className="space-y-4 mb-8">
                            <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center">
                                <MessageSquare className="h-6 w-6" />
                            </div>
                            <h3 className="text-2xl font-bold text-slate-900">알림톡 자동화</h3>
                            <p className="text-slate-600 leading-relaxed">
                                카카오 알림톡을 조건에 따라 자동 발송하세요. 템플릿 변수 매핑으로 개인화된 메시지를 보냅니다.
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { label: "발송 성공", value: "98.2%", color: "text-green-600" },
                                { label: "자동 발송", value: "1,240건", color: "text-violet-600" },
                            ].map((stat) => (
                                <div key={stat.label} className="rounded-xl border border-slate-100 p-4 bg-slate-50 text-center">
                                    <p className="text-[10px] text-slate-400 mb-1">{stat.label}</p>
                                    <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                                </div>
                            ))}
                        </div>
                    </AnimateOnScroll>

                    {/* AI — dark card */}
                    <AnimateOnScroll delay={300} className="lg:col-span-7 bg-slate-900 rounded-3xl p-8 text-white overflow-hidden flex flex-col md:flex-row gap-8 items-center group">
                        <div className="md:w-1/2 space-y-4">
                            <div className="w-12 h-12 rounded-xl bg-linear-to-tr from-blue-500 to-violet-500 flex items-center justify-center">
                                <Sparkles className="h-6 w-6 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold text-white">AI 어시스턴트</h3>
                            <p className="text-slate-400">이메일 작성, 기업 조사, 웹 폼 생성까지 AI가 도와줍니다.</p>
                            <ul className="space-y-2 text-sm text-slate-300">
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-blue-400" /> AI 맞춤형 이메일 자동 생성</li>
                                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-blue-400" /> 기업 정보 웹 검색 자동 조사</li>
                            </ul>
                        </div>
                        <div className="md:w-1/2 h-full min-h-[200px] flex items-center justify-center">
                            <div className="relative w-full aspect-square bg-linear-to-br from-blue-500/20 to-violet-500/20 rounded-full flex items-center justify-center animate-pulse max-w-48">
                                <Sparkles className="h-16 w-16 text-blue-400" />
                            </div>
                        </div>
                    </AnimateOnScroll>
                </div>
            </div>
        </section>
    );
}
