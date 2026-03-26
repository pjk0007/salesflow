import Link from "next/link";
import AnimateOnScroll from "./AnimateOnScroll";

function DashboardMockup() {
    return (
        <div className="relative">
            <div className="absolute -top-20 -right-20 w-96 h-96 bg-blue-400/20 blur-[100px] rounded-full" />
            <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-violet-400/20 blur-[100px] rounded-full" />
            <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 hover:scale-[1.02] transition-transform duration-500">
                {/* Title bar */}
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-3">
                    <div className="flex gap-1.5">
                        <div className="h-3 w-3 rounded-full bg-red-400" />
                        <div className="h-3 w-3 rounded-full bg-yellow-400" />
                        <div className="h-3 w-3 rounded-full bg-green-400" />
                    </div>
                    <span className="ml-2 text-xs text-slate-400">Sendb Dashboard</span>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                    {[
                        { label: "신규 고객", value: "128", change: "+12%" },
                        { label: "전환율", value: "34.2%", change: "+5.1%" },
                        { label: "월 매출", value: "₩4,200만", change: "+18%" },
                    ].map((stat) => (
                        <div key={stat.label} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                            <p className="text-[10px] text-slate-400">{stat.label}</p>
                            <p className="text-lg font-bold text-slate-900">{stat.value}</p>
                            <p className="text-[10px] text-emerald-500 font-medium">{stat.change}</p>
                        </div>
                    ))}
                </div>
                {/* Chart */}
                <div className="flex items-end gap-1.5 h-20 px-2">
                    {[40, 55, 35, 65, 45, 80, 60, 75, 50, 90, 70, 85].map((h, i) => (
                        <div key={i} className="flex-1 rounded-sm bg-blue-500/20" style={{ height: `${h}%` }} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function HeroSection() {
    return (
        <section className="min-h-screen flex items-center bg-linear-to-br from-blue-50 via-white to-violet-50 overflow-hidden">
            <div className="max-w-7xl mx-auto px-6 md:px-12 grid lg:grid-cols-2 gap-12 items-center w-full">
                <AnimateOnScroll>
                    <div className="space-y-8">
                        <span className="inline-block px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold tracking-wide">
                            영업 자동화의 새로운 기준
                        </span>
                        <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 leading-[1.15] tracking-tight">
                            영업의 모든 것을 <br />
                            <span className="bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">한 곳에서 관리하세요</span>
                        </h1>
                        <p className="text-lg md:text-xl text-slate-600 leading-relaxed max-w-lg">
                            고객 관리, 이메일 자동화, AI 어시스턴트까지. Sendb로 영업 생산성을 극대화하세요.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <Link href="/signup"
                                className="px-8 py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 transition-all text-center">
                                무료로 시작하기
                            </Link>
                            <a href="#features"
                                className="px-8 py-4 bg-white text-slate-700 border border-slate-200 font-bold rounded-xl hover:bg-slate-50 transition-all text-center">
                                자세히 알아보기
                            </a>
                        </div>
                    </div>
                </AnimateOnScroll>

                <AnimateOnScroll delay={200} className="hidden md:block">
                    <DashboardMockup />
                </AnimateOnScroll>
            </div>
        </section>
    );
}
