"use client";

import React, { useState } from "react";
import { Users, Mail, BarChart3, Sparkles } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const TABS = [
    {
        id: "crm",
        icon: Users,
        label: "고객 관리",
        title: "체계적인 고객 데이터 관리",
        description: "모든 고객 정보를 한 곳에서 관리하세요. 커스텀 필드로 팀에 맞는 CRM을 구성할 수 있습니다.",
        bullets: [
            "커스텀 필드로 자유로운 데이터 구조",
            "파이프라인별 고객 분류와 추적",
            "CSV 가져오기/내보내기 지원",
        ],
    },
    {
        id: "email",
        icon: Mail,
        label: "이메일 자동화",
        title: "자동으로 보내는 이메일",
        description: "조건 기반 자동 발송으로 반복 업무를 줄이세요. 템플릿과 개인화로 높은 오픈율을 달성합니다.",
        bullets: [
            "조건 기반 자동 발송 설정",
            "개인화 변수로 맞춤 이메일",
            "발송 이력과 성과 추적",
        ],
    },
    {
        id: "dashboard",
        icon: BarChart3,
        label: "대시보드",
        title: "실시간 데이터 시각화",
        description: "드래그 앤 드롭으로 대시보드를 구성하고 영업 현황을 한눈에 파악하세요.",
        bullets: [
            "다양한 위젯으로 자유 배치",
            "AI 자동 대시보드 생성",
            "파티션별 데이터 범위 설정",
        ],
    },
    {
        id: "ai",
        icon: Sparkles,
        label: "AI 도우미",
        title: "AI가 돕는 영업 활동",
        description: "이메일 작성, 기업 조사, 위젯 설정까지 AI가 도와줍니다.",
        bullets: [
            "자연어로 이메일 자동 생성",
            "기업 정보 자동 조사",
            "AI 대시보드 위젯 추천",
        ],
    },
];

function CrmMockup() {
    return (
        <div className="rounded-lg border text-[11px]">
            <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 font-medium text-muted-foreground">
                <span>이름</span><span>회사</span><span>상태</span><span>연락처</span>
            </div>
            {[
                { name: "김민수", company: "테크코리아", status: "활성", phone: "010-1234-5678" },
                { name: "이서연", company: "그린에너지", status: "잠재", phone: "010-9876-5432" },
                { name: "박지훈", company: "스마트물류", status: "활성", phone: "010-5555-1234" },
            ].map((r) => (
                <div key={r.name} className="grid grid-cols-4 gap-2 px-3 py-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.company}</span>
                    <span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            r.status === "활성" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        }`}>{r.status}</span>
                    </span>
                    <span className="text-muted-foreground">{r.phone}</span>
                </div>
            ))}
        </div>
    );
}

function EmailMockup() {
    return (
        <div className="space-y-2">
            {[
                { subject: "신제품 안내 메일", status: "발송완료", date: "2026-02-25" },
                { subject: "미팅 후속 안내", status: "예약됨", date: "2026-02-28" },
                { subject: "프로모션 안내", status: "초안", date: "-" },
            ].map((e) => (
                <div key={e.subject} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-[11px]">
                    <span className="font-medium">{e.subject}</span>
                    <div className="flex items-center gap-3">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            e.status === "발송완료" ? "bg-green-100 text-green-700"
                            : e.status === "예약됨" ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-700"
                        }`}>{e.status}</span>
                        <span className="text-muted-foreground">{e.date}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function DashboardMockup() {
    return (
        <div className="grid grid-cols-2 gap-2">
            {[
                { label: "월간 매출", bars: [40, 65, 80, 55, 90] },
                { label: "신규 고객", bars: [30, 50, 45, 70, 60] },
            ].map((chart) => (
                <div key={chart.label} className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground mb-2">{chart.label}</p>
                    <div className="flex items-end gap-1 h-16">
                        {chart.bars.map((h, i) => (
                            <div key={i} className="flex-1 rounded-sm bg-primary/20" style={{ height: `${h}%` }} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function AiMockup() {
    return (
        <div className="space-y-3 text-[11px]">
            <div className="flex justify-end">
                <div className="rounded-lg bg-primary text-primary-foreground px-3 py-2 max-w-[200px]">
                    테크코리아에 보낼 제안 이메일 작성해줘
                </div>
            </div>
            <div className="flex justify-start">
                <div className="rounded-lg border px-3 py-2 max-w-[240px] space-y-1">
                    <p className="font-medium">AI 도우미</p>
                    <p className="text-muted-foreground">테크코리아의 최근 활동을 분석하여 맞춤형 제안 이메일을 생성했습니다.</p>
                    <div className="rounded bg-muted p-2 text-[10px]">
                        안녕하세요 김태현님, 최근 클라우드 전환을 검토 중이신...
                    </div>
                </div>
            </div>
        </div>
    );
}

const MOCKUPS: Record<string, () => React.ReactNode> = {
    crm: CrmMockup,
    email: EmailMockup,
    dashboard: DashboardMockup,
    ai: AiMockup,
};

export default function ProductPreviewSection() {
    const [activeTab, setActiveTab] = useState("crm");
    const tab = TABS.find((t) => t.id === activeTab)!;
    const Mockup = MOCKUPS[activeTab];

    return (
        <section className="py-20 px-4">
            <div className="container mx-auto">
                <AnimateOnScroll>
                    <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                        하나의 플랫폼에서 모든 것을
                    </h2>
                    <p className="mt-4 text-center text-muted-foreground">
                        영업에 필요한 도구가 모두 준비되어 있습니다
                    </p>
                </AnimateOnScroll>

                {/* Tab bar */}
                <AnimateOnScroll className="mt-10">
                    <div className="flex justify-center gap-2 flex-wrap">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setActiveTab(t.id)}
                                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
                                    activeTab === t.id
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <t.icon className="h-4 w-4" />
                                {t.label}
                            </button>
                        ))}
                    </div>
                </AnimateOnScroll>

                {/* Preview area */}
                <div className="mt-12 grid lg:grid-cols-2 gap-10 items-center max-w-5xl mx-auto">
                    <div key={tab.id} className="transition-opacity duration-300">
                        <h3 className="text-2xl font-bold">{tab.title}</h3>
                        <p className="mt-3 text-muted-foreground">{tab.description}</p>
                        <ul className="mt-4 space-y-2">
                            {tab.bullets.map((b) => (
                                <li key={b} className="flex items-center gap-2 text-sm">
                                    <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                    {b}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div key={`mockup-${tab.id}`} className="rounded-2xl border shadow-lg p-5 bg-background transition-opacity duration-300">
                        <Mockup />
                    </div>
                </div>
            </div>
        </section>
    );
}
