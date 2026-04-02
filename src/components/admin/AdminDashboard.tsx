"use client";

import useSWR from "swr";
import { Building2, Users, UserPlus, TrendingUp } from "lucide-react";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AdminDashboard() {
    const { data, isLoading } = useSWR("/api/admin/stats", fetcher);
    const stats = data?.data;

    if (isLoading || !stats) {
        return <div className="text-center py-12 text-muted-foreground">로딩 중...</div>;
    }

    const cards = [
        { label: "전체 조직", value: stats.totalOrganizations, icon: Building2 },
        { label: "전체 사용자", value: stats.totalUsers, icon: Users },
        { label: "활성 사용자", value: stats.activeUsers, icon: TrendingUp },
        { label: "최근 30일 가입", value: stats.newUsersMonth, icon: UserPlus },
    ];

    return (
        <div className="space-y-8">
            {/* 통계 카드 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((c) => (
                    <div key={c.label} className="bg-white rounded-xl border p-5">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="rounded-lg bg-blue-50 p-2">
                                <c.icon className="h-5 w-5 text-blue-600" />
                            </div>
                            <span className="text-sm text-muted-foreground">{c.label}</span>
                        </div>
                        <p className="text-3xl font-bold">{c.value?.toLocaleString()}</p>
                    </div>
                ))}
            </div>

            {/* 구독 현황 */}
            <div className="bg-white rounded-xl border p-6">
                <h3 className="font-semibold mb-4">구독 현황</h3>
                <div className="flex gap-6">
                    {stats.subscriptionsByPlan?.length > 0 ? (
                        stats.subscriptionsByPlan.map((s: { planName: string; count: number }) => (
                            <div key={s.planName} className="text-center">
                                <p className="text-2xl font-bold">{s.count}</p>
                                <p className="text-sm text-muted-foreground">{s.planName}</p>
                            </div>
                        ))
                    ) : (
                        <p className="text-sm text-muted-foreground">활성 구독 없음</p>
                    )}
                </div>
            </div>

            {/* 가입 추이 */}
            <div className="bg-white rounded-xl border p-6">
                <h3 className="font-semibold mb-4">최근 30일 가입 추이</h3>
                {stats.signupTrend?.length > 0 ? (
                    <div className="flex items-end gap-1 h-32">
                        {stats.signupTrend.map((d: { date: string; count: number }) => {
                            const max = Math.max(...stats.signupTrend.map((t: { count: number }) => t.count), 1);
                            return (
                                <div key={d.date} className="flex-1 group relative">
                                    <div
                                        className="bg-blue-500 rounded-t-sm min-h-[2px] transition-all hover:bg-blue-600"
                                        style={{ height: `${(d.count / max) * 100}%` }}
                                    />
                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                                        {d.date}: {d.count}명
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">데이터 없음</p>
                )}
            </div>
        </div>
    );
}
