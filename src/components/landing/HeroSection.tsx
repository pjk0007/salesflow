import Link from "next/link";
import { Button } from "@/components/ui/button";
import AnimateOnScroll from "./AnimateOnScroll";

function DashboardMockup() {
    return (
        <div className="rounded-2xl border shadow-2xl bg-background overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-400" />
                    <div className="h-3 w-3 rounded-full bg-yellow-400" />
                    <div className="h-3 w-3 rounded-full bg-green-400" />
                </div>
                <span className="ml-2 text-xs text-muted-foreground">SalesFlow Dashboard</span>
            </div>

            <div className="p-4 space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: "신규 고객", value: "128", change: "+12%" },
                        { label: "전환율", value: "34.2%", change: "+5.1%" },
                        { label: "월 매출", value: "₩4,200만", change: "+18%" },
                    ].map((stat) => (
                        <div key={stat.label} className="rounded-lg border p-3">
                            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                            <p className="text-lg font-bold">{stat.value}</p>
                            <p className="text-[10px] text-green-500">{stat.change}</p>
                        </div>
                    ))}
                </div>

                {/* Table mockup */}
                <div className="rounded-lg border">
                    <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-[10px] font-medium text-muted-foreground">
                        <span>고객명</span>
                        <span>회사</span>
                        <span>상태</span>
                        <span>금액</span>
                    </div>
                    {[
                        { name: "김영수", company: "테크코리아", status: "진행중", amount: "₩500만" },
                        { name: "이지현", company: "디지털랩", status: "완료", amount: "₩320만" },
                        { name: "박민호", company: "스타트업허브", status: "검토중", amount: "₩180만" },
                    ].map((row) => (
                        <div key={row.name} className="grid grid-cols-4 gap-2 px-3 py-2 text-[11px]">
                            <span className="font-medium">{row.name}</span>
                            <span className="text-muted-foreground">{row.company}</span>
                            <span>
                                <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                                    row.status === "완료"
                                        ? "bg-green-100 text-green-700"
                                        : row.status === "진행중"
                                        ? "bg-blue-100 text-blue-700"
                                        : "bg-yellow-100 text-yellow-700"
                                }`}>
                                    {row.status}
                                </span>
                            </span>
                            <span className="font-medium">{row.amount}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function HeroSection() {
    return (
        <section className="py-20 lg:py-28 px-4">
            <div className="container mx-auto">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    <AnimateOnScroll>
                        <div className="flex flex-col items-start">
                            {/* Badge */}
                            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                                </span>
                                영업 자동화 플랫폼
                            </div>

                            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                                영업의 모든 것을
                                <br />
                                한 곳에서 관리하세요
                            </h1>
                            <p className="mt-6 max-w-lg text-lg text-muted-foreground">
                                고객 관리부터 이메일 자동화, AI 도우미까지.
                                스마트한 영업 관리 플랫폼으로 성과를 높이세요.
                            </p>
                            <div className="mt-8 flex items-center gap-4">
                                <Button size="lg" asChild>
                                    <Link href="/signup">무료로 시작하기</Link>
                                </Button>
                                <Button size="lg" variant="outline" asChild>
                                    <Link href="#features">자세히 알아보기</Link>
                                </Button>
                            </div>
                            <p className="mt-4 text-xs text-muted-foreground">
                                신용카드 없이 무료로 시작 · 설정 5분
                            </p>
                        </div>
                    </AnimateOnScroll>

                    <AnimateOnScroll delay={200} className="hidden md:block">
                        <DashboardMockup />
                    </AnimateOnScroll>
                </div>
            </div>
        </section>
    );
}
