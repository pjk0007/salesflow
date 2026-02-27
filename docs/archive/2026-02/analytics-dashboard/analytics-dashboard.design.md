# Design: analytics-dashboard — 통합 통계 대시보드

> **Plan 문서**: [analytics-dashboard.plan.md](../../01-plan/features/analytics-dashboard.plan.md)

## 1. 개요

홈 대시보드에 발송 분석 섹션 추가. 일별 추이 차트(recharts AreaChart), 채널별 요약 카드, 템플릿 성과 테이블. 기간 프리셋(7일/30일/90일) 선택.

## 2. 구현 순서

```
1. package.json (수정) — recharts 의존성 추가
2. src/pages/api/analytics/trends.ts (신규) — 일별 추이 API
3. src/pages/api/analytics/summary.ts (신규) — 채널 요약 API
4. src/pages/api/analytics/templates.ts (신규) — 템플릿 성과 API
5. src/hooks/useAnalytics.ts (신규) — SWR 훅 (3개 API 통합)
6. src/components/dashboard/TrendChart.tsx (신규) — recharts AreaChart 컴포넌트
7. src/components/dashboard/TemplateRanking.tsx (신규) — 템플릿 성과 테이블
8. src/components/dashboard/AnalyticsSection.tsx (신규) — 분석 섹션 (기간선택 + 차트 + 요약 + 테이블)
9. src/components/dashboard/HomeDashboard.tsx (수정) — AnalyticsSection 렌더 추가
```

## 3. 컴포넌트 설계

### 3.1 package.json (수정)

**의존성 추가**:
```bash
pnpm add recharts
```

recharts는 자체 TypeScript 타입을 포함하므로 `@types/recharts` 불필요.

---

### 3.2 src/pages/api/analytics/trends.ts (신규)

**패턴**: 기존 `dashboard/summary.ts` + `alimtalk/stats.ts` 참고

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**핸들러**:
- GET only, 405 for non-GET
- 인증 체크: `getUserFromRequest()` → 401
- 쿼리 파라미터: `startDate`, `endDate`, `channel` (기본 "all")

**쿼리 파라미터 파싱**:
```typescript
const { startDate, endDate, channel = "all" } = req.query as {
    startDate?: string;
    endDate?: string;
    channel?: string;
};

if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: "startDate, endDate는 필수입니다." });
}

const start = new Date(startDate as string);
const end = new Date(endDate as string);
end.setHours(23, 59, 59, 999);
```

**알림톡 일별 집계**:
```typescript
const alimtalkTrends = (channel === "email") ? [] :
    await db
        .select({
            date: sql<string>`date_trunc('day', ${alimtalkSendLogs.sentAt})::date::text`.as("date"),
            sent: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} = 'sent')::int`.as("sent"),
            failed: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
        })
        .from(alimtalkSendLogs)
        .where(and(
            eq(alimtalkSendLogs.orgId, orgId),
            gte(alimtalkSendLogs.sentAt, start),
            lte(alimtalkSendLogs.sentAt, end),
        ))
        .groupBy(sql`date_trunc('day', ${alimtalkSendLogs.sentAt})`)
        .orderBy(sql`date_trunc('day', ${alimtalkSendLogs.sentAt})`);
```

**이메일 일별 집계**:
```typescript
const emailTrends = (channel === "alimtalk") ? [] :
    await db
        .select({
            date: sql<string>`date_trunc('day', ${emailSendLogs.sentAt})::date::text`.as("date"),
            sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`.as("sent"),
            failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
        })
        .from(emailSendLogs)
        .where(and(
            eq(emailSendLogs.orgId, orgId),
            gte(emailSendLogs.sentAt, start),
            lte(emailSendLogs.sentAt, end),
        ))
        .groupBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`)
        .orderBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`);
```

**데이터 머지**:
```typescript
// Map으로 날짜별 합산
const map = new Map<string, {
    date: string;
    alimtalkSent: number;
    alimtalkFailed: number;
    emailSent: number;
    emailFailed: number;
}>();

for (const row of alimtalkTrends) {
    map.set(row.date, {
        date: row.date,
        alimtalkSent: row.sent,
        alimtalkFailed: row.failed,
        emailSent: 0,
        emailFailed: 0,
    });
}

for (const row of emailTrends) {
    const existing = map.get(row.date);
    if (existing) {
        existing.emailSent = row.sent;
        existing.emailFailed = row.failed;
    } else {
        map.set(row.date, {
            date: row.date,
            alimtalkSent: 0,
            alimtalkFailed: 0,
            emailSent: row.sent,
            emailFailed: row.failed,
        });
    }
}

const data = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
```

**응답**:
```typescript
return res.status(200).json({ success: true, data });
```

**에러 핸들링**: try-catch, console.error, 500

---

### 3.3 src/pages/api/analytics/summary.ts (신규)

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**핸들러**: GET only, 인증 체크

**쿼리 파라미터**: `startDate`, `endDate` (필수)

**쿼리 3개 Promise.all**:
```typescript
const [alimtalkStats, emailStats, newRecordsCount] = await Promise.all([
    // 1. 알림톡 상태별 카운트
    db.select({
        status: alimtalkSendLogs.status,
        count: sql<number>`count(*)::int`,
    })
        .from(alimtalkSendLogs)
        .where(and(
            eq(alimtalkSendLogs.orgId, orgId),
            gte(alimtalkSendLogs.sentAt, start),
            lte(alimtalkSendLogs.sentAt, end),
        ))
        .groupBy(alimtalkSendLogs.status),

    // 2. 이메일 상태별 카운트
    db.select({
        status: emailSendLogs.status,
        count: sql<number>`count(*)::int`,
    })
        .from(emailSendLogs)
        .where(and(
            eq(emailSendLogs.orgId, orgId),
            gte(emailSendLogs.sentAt, start),
            lte(emailSendLogs.sentAt, end),
        ))
        .groupBy(emailSendLogs.status),

    // 3. 기간 내 신규 레코드 수
    db.select({ count: sql<number>`count(*)::int` })
        .from(records)
        .where(and(
            eq(records.orgId, orgId),
            gte(records.createdAt, start),
            lte(records.createdAt, end),
        )),
]);
```

**집계 로직** — 기존 `dashboard/summary.ts`와 동일 패턴:
```typescript
function aggregateStats(rows: Array<{ status: string; count: number }>) {
    let total = 0, sent = 0, failed = 0, pending = 0;
    for (const row of rows) {
        total += row.count;
        if (row.status === "sent") sent = row.count;
        else if (row.status === "failed" || row.status === "rejected") failed += row.count;
        else if (row.status === "pending") pending = row.count;
    }
    return { total, sent, failed, pending };
}
```

**응답**:
```typescript
return res.status(200).json({
    success: true,
    data: {
        alimtalk: aggregateStats(alimtalkStats),
        email: aggregateStats(emailStats),
        newRecordsInPeriod: newRecordsCount[0]?.count ?? 0,
    },
});
```

---

### 3.4 src/pages/api/analytics/templates.ts (신규)

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, alimtalkSendLogs, emailSendLogs } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**핸들러**: GET only, 인증 체크

**쿼리 파라미터**: `startDate`, `endDate`, `channel` (기본 "all"), `limit` (기본 10)

```typescript
const limit = Math.min(Number(req.query.limit) || 10, 50);
```

**알림톡 템플릿 집계**:
```typescript
const alimtalkTemplates = (channel === "email") ? [] :
    await db
        .select({
            name: alimtalkSendLogs.templateName,
            total: sql<number>`count(*)::int`.as("total"),
            sent: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} = 'sent')::int`.as("sent"),
            failed: sql<number>`count(*) filter (where ${alimtalkSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
        })
        .from(alimtalkSendLogs)
        .where(and(
            eq(alimtalkSendLogs.orgId, orgId),
            gte(alimtalkSendLogs.sentAt, start),
            lte(alimtalkSendLogs.sentAt, end),
        ))
        .groupBy(alimtalkSendLogs.templateName)
        .orderBy(sql`count(*) desc`)
        .limit(limit);
```

**이메일 템플릿 집계**:
```typescript
const emailTemplates = (channel === "alimtalk") ? [] :
    await db
        .select({
            name: emailSendLogs.subject,
            total: sql<number>`count(*)::int`.as("total"),
            sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`.as("sent"),
            failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
        })
        .from(emailSendLogs)
        .where(and(
            eq(emailSendLogs.orgId, orgId),
            gte(emailSendLogs.sentAt, start),
            lte(emailSendLogs.sentAt, end),
        ))
        .groupBy(emailSendLogs.subject)
        .orderBy(sql`count(*) desc`)
        .limit(limit);
```

**데이터 합산 + 정렬**:
```typescript
const combined = [
    ...alimtalkTemplates.map(t => ({
        name: t.name || "(이름 없음)",
        channel: "alimtalk" as const,
        total: t.total,
        sent: t.sent,
        failed: t.failed,
        successRate: t.total > 0 ? Math.round((t.sent / t.total) * 100) : 0,
    })),
    ...emailTemplates.map(t => ({
        name: t.name || "(제목 없음)",
        channel: "email" as const,
        total: t.total,
        sent: t.sent,
        failed: t.failed,
        successRate: t.total > 0 ? Math.round((t.sent / t.total) * 100) : 0,
    })),
]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
```

**응답**:
```typescript
return res.status(200).json({ success: true, data: combined });
```

---

### 3.5 src/hooks/useAnalytics.ts (신규)

**패턴**: useDashboardSummary + useAlimtalkStats 참고

**import**:
```typescript
import useSWR from "swr";
```

**타입 정의**:
```typescript
export interface TrendItem {
    date: string;
    alimtalkSent: number;
    alimtalkFailed: number;
    emailSent: number;
    emailFailed: number;
}

export interface ChannelSummary {
    total: number;
    sent: number;
    failed: number;
    pending: number;
}

export interface AnalyticsSummary {
    alimtalk: ChannelSummary;
    email: ChannelSummary;
    newRecordsInPeriod: number;
}

export interface TemplatePerformance {
    name: string;
    channel: "alimtalk" | "email";
    total: number;
    sent: number;
    failed: number;
    successRate: number;
}

type Period = "7d" | "30d" | "90d";
```

**날짜 헬퍼**:
```typescript
function getDateRange(period: Period): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date();
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    start.setDate(start.getDate() - days);
    return {
        startDate: start.toISOString().split("T")[0],
        endDate: end.toISOString().split("T")[0],
    };
}
```

**fetcher**:
```typescript
const fetcher = (url: string) => fetch(url).then((r) => r.json());
```

**훅 본체**:
```typescript
export function useAnalytics(period: Period = "30d", channel: string = "all") {
    const { startDate, endDate } = getDateRange(period);

    const trendsKey = `/api/analytics/trends?startDate=${startDate}&endDate=${endDate}&channel=${channel}`;
    const summaryKey = `/api/analytics/summary?startDate=${startDate}&endDate=${endDate}`;
    const templatesKey = `/api/analytics/templates?startDate=${startDate}&endDate=${endDate}&channel=${channel}&limit=10`;

    const { data: trendsData, isLoading: trendsLoading } = useSWR<{
        success: boolean;
        data?: TrendItem[];
    }>(trendsKey, fetcher, { refreshInterval: 60000 });

    const { data: summaryData, isLoading: summaryLoading } = useSWR<{
        success: boolean;
        data?: AnalyticsSummary;
    }>(summaryKey, fetcher, { refreshInterval: 60000 });

    const { data: templatesData, isLoading: templatesLoading } = useSWR<{
        success: boolean;
        data?: TemplatePerformance[];
    }>(templatesKey, fetcher, { refreshInterval: 60000 });

    return {
        trends: trendsData?.data ?? [],
        summary: summaryData?.data ?? {
            alimtalk: { total: 0, sent: 0, failed: 0, pending: 0 },
            email: { total: 0, sent: 0, failed: 0, pending: 0 },
            newRecordsInPeriod: 0,
        },
        templates: templatesData?.data ?? [],
        isLoading: trendsLoading || summaryLoading || templatesLoading,
    };
}
```

---

### 3.6 src/components/dashboard/TrendChart.tsx (신규)

**import**:
```typescript
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import type { TrendItem } from "@/hooks/useAnalytics";
```

**Props**:
```typescript
interface TrendChartProps {
    data: TrendItem[];
    channel: string;
}
```

**날짜 포맷 헬퍼**:
```typescript
function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}
```

**컴포넌트**:
```typescript
export default function TrendChart({ data, channel }: TrendChartProps) {
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                해당 기간의 발송 이력이 없습니다.
            </div>
        );
    }

    const showAlimtalk = channel !== "email";
    const showEmail = channel !== "alimtalk";

    return (
        <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    className="text-xs"
                />
                <YAxis className="text-xs" allowDecimals={false} />
                <Tooltip
                    labelFormatter={(label) => new Date(label as string).toLocaleDateString("ko-KR")}
                    formatter={(value: number, name: string) => [
                        `${value}건`,
                        name,
                    ]}
                />
                <Legend />
                {showAlimtalk && (
                    <>
                        <Area
                            type="monotone"
                            dataKey="alimtalkSent"
                            name="알림톡 성공"
                            stackId="alimtalk"
                            stroke="#22c55e"
                            fill="#22c55e"
                            fillOpacity={0.3}
                        />
                        <Area
                            type="monotone"
                            dataKey="alimtalkFailed"
                            name="알림톡 실패"
                            stackId="alimtalk"
                            stroke="#ef4444"
                            fill="#ef4444"
                            fillOpacity={0.3}
                        />
                    </>
                )}
                {showEmail && (
                    <>
                        <Area
                            type="monotone"
                            dataKey="emailSent"
                            name="이메일 성공"
                            stackId="email"
                            stroke="#3b82f6"
                            fill="#3b82f6"
                            fillOpacity={0.3}
                        />
                        <Area
                            type="monotone"
                            dataKey="emailFailed"
                            name="이메일 실패"
                            stackId="email"
                            stroke="#f97316"
                            fill="#f97316"
                            fillOpacity={0.3}
                        />
                    </>
                )}
            </AreaChart>
        </ResponsiveContainer>
    );
}
```

**색상 체계**:
- 알림톡 성공: green-500 (#22c55e)
- 알림톡 실패: red-500 (#ef4444)
- 이메일 성공: blue-500 (#3b82f6)
- 이메일 실패: orange-500 (#f97316)

---

### 3.7 src/components/dashboard/TemplateRanking.tsx (신규)

**import**:
```typescript
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { TemplatePerformance } from "@/hooks/useAnalytics";
```

**Props**:
```typescript
interface TemplateRankingProps {
    data: TemplatePerformance[];
}
```

**컴포넌트**:
```typescript
export default function TemplateRanking({ data }: TemplateRankingProps) {
    if (data.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-6">
                해당 기간의 템플릿 발송 이력이 없습니다.
            </p>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>템플릿명</TableHead>
                    <TableHead className="w-[80px]">채널</TableHead>
                    <TableHead className="w-[70px] text-right">전체</TableHead>
                    <TableHead className="w-[70px] text-right">성공</TableHead>
                    <TableHead className="w-[70px] text-right">실패</TableHead>
                    <TableHead className="w-[80px] text-right">성공률</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((item, index) => (
                    <TableRow key={`${item.channel}-${item.name}-${index}`}>
                        <TableCell className="text-muted-foreground">
                            {index + 1}
                        </TableCell>
                        <TableCell className="font-medium truncate max-w-[200px]">
                            {item.name}
                        </TableCell>
                        <TableCell>
                            <Badge variant={item.channel === "alimtalk" ? "default" : "secondary"}>
                                {item.channel === "alimtalk" ? "알림톡" : "이메일"}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">{item.total}</TableCell>
                        <TableCell className="text-right text-green-600">{item.sent}</TableCell>
                        <TableCell className="text-right text-red-600">{item.failed}</TableCell>
                        <TableCell className="text-right font-medium">
                            {item.successRate}%
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
```

---

### 3.8 src/components/dashboard/AnalyticsSection.tsx (신규)

**import**:
```typescript
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { MessageSquare, Mail, TrendingUp, BarChart3 } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import type { Period } from "@/hooks/useAnalytics";
import TrendChart from "./TrendChart";
import TemplateRanking from "./TemplateRanking";
```

> Note: `Period` 타입을 useAnalytics에서 export 필요

**내부 상태**:
```typescript
const [period, setPeriod] = useState<Period>("30d");
const [channel, setChannel] = useState("all");
const { trends, summary, templates, isLoading } = useAnalytics(period, channel);
```

**컴포넌트 구조**:
```
<div className="space-y-4">
├── {/* 헤더 + 기간/채널 선택 */}
│   <div className="flex items-center justify-between">
│       <h2 className="text-lg font-semibold flex items-center gap-2">
│           <BarChart3 className="h-5 w-5" />
│           발송 분석
│       </h2>
│       <div className="flex items-center gap-2">
│           {/* 기간 프리셋 버튼 */}
│           <div className="flex gap-1">
│               {(["7d", "30d", "90d"] as const).map((p) => (
│                   <Button
│                       key={p}
│                       variant={period === p ? "default" : "outline"}
│                       size="sm"
│                       onClick={() => setPeriod(p)}
│                   >
│                       {p === "7d" ? "7일" : p === "30d" ? "30일" : "90일"}
│                   </Button>
│               ))}
│           </div>
│           {/* 채널 필터 */}
│           <Select value={channel} onValueChange={setChannel}>
│               <SelectTrigger className="w-[120px]">
│                   <SelectValue />
│               </SelectTrigger>
│               <SelectContent>
│                   <SelectItem value="all">전체</SelectItem>
│                   <SelectItem value="alimtalk">알림톡</SelectItem>
│                   <SelectItem value="email">이메일</SelectItem>
│               </SelectContent>
│           </Select>
│       </div>
│   </div>
│
├── {/* 채널 요약 카드 */}
│   <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
│       {/* 알림톡 요약 */}
│       <Card>
│           <CardContent className="p-4">
│               <div className="flex items-center justify-between">
│                   <div>
│                       <p className="text-xs text-muted-foreground">알림톡</p>
│                       <p className="text-2xl font-bold text-green-600">
│                           {isLoading ? "-" : summary.alimtalk.total.toLocaleString()}
│                       </p>
│                       <p className="text-xs text-muted-foreground">
│                           성공 {summary.alimtalk.sent} · 실패 {summary.alimtalk.failed}
│                           {summary.alimtalk.total > 0 &&
│                               ` · ${Math.round((summary.alimtalk.sent / summary.alimtalk.total) * 100)}%`}
│                       </p>
│                   </div>
│                   <MessageSquare className="h-8 w-8 text-green-600 opacity-20" />
│               </div>
│           </CardContent>
│       </Card>
│       {/* 이메일 요약 */}
│       <Card>
│           <CardContent className="p-4">
│               <div className="flex items-center justify-between">
│                   <div>
│                       <p className="text-xs text-muted-foreground">이메일</p>
│                       <p className="text-2xl font-bold text-blue-600">
│                           {isLoading ? "-" : summary.email.total.toLocaleString()}
│                       </p>
│                       <p className="text-xs text-muted-foreground">
│                           성공 {summary.email.sent} · 실패 {summary.email.failed}
│                           {summary.email.total > 0 &&
│                               ` · ${Math.round((summary.email.sent / summary.email.total) * 100)}%`}
│                       </p>
│                   </div>
│                   <Mail className="h-8 w-8 text-blue-600 opacity-20" />
│               </div>
│           </CardContent>
│       </Card>
│       {/* 신규 레코드 */}
│       <Card>
│           <CardContent className="p-4">
│               <div className="flex items-center justify-between">
│                   <div>
│                       <p className="text-xs text-muted-foreground">신규 레코드</p>
│                       <p className="text-2xl font-bold text-purple-600">
│                           {isLoading ? "-" : summary.newRecordsInPeriod.toLocaleString()}
│                       </p>
│                       <p className="text-xs text-muted-foreground">선택 기간 내</p>
│                   </div>
│                   <TrendingUp className="h-8 w-8 text-purple-600 opacity-20" />
│               </div>
│           </CardContent>
│       </Card>
│   </div>
│
├── {/* 일별 추이 차트 */}
│   <Card>
│       <CardHeader>
│           <CardTitle className="text-base">일별 발송 추이</CardTitle>
│       </CardHeader>
│       <CardContent>
│           {isLoading ? (
│               <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
│                   로딩 중...
│               </div>
│           ) : (
│               <TrendChart data={trends} channel={channel} />
│           )}
│       </CardContent>
│   </Card>
│
├── {/* 템플릿 성과 */}
│   <Card>
│       <CardHeader>
│           <CardTitle className="text-base">템플릿별 성과 (Top 10)</CardTitle>
│       </CardHeader>
│       <CardContent>
│           {isLoading ? (
│               <p className="text-sm text-muted-foreground text-center py-6">로딩 중...</p>
│           ) : (
│               <TemplateRanking data={templates} />
│           )}
│       </CardContent>
│   </Card>
</div>
```

---

### 3.9 src/components/dashboard/HomeDashboard.tsx (수정)

**import 추가**:
```typescript
import AnalyticsSection from "./AnalyticsSection";
```

**렌더 추가** — `<QuickActions />` 뒤에:

```tsx
{/* 기존 QuickActions 아래 */}
<QuickActions />

{/* 발송 분석 */}
<AnalyticsSection />
```

변경 위치: `return` 블록 내 `<div className="space-y-6">` 안, `<QuickActions />` 바로 아래.

## 4. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `package.json` | 수정 | recharts |
| 2 | `src/pages/api/analytics/trends.ts` | 신규 ~90줄 | 일별 추이 API (date_trunc GROUP BY) |
| 3 | `src/pages/api/analytics/summary.ts` | 신규 ~80줄 | 채널 요약 API (기간별 상태 집계) |
| 4 | `src/pages/api/analytics/templates.ts` | 신규 ~80줄 | 템플릿 성과 API (GROUP BY templateName/subject) |
| 5 | `src/hooks/useAnalytics.ts` | 신규 ~70줄 | SWR 훅 3개 API 병렬 호출 |
| 6 | `src/components/dashboard/TrendChart.tsx` | 신규 ~80줄 | recharts AreaChart |
| 7 | `src/components/dashboard/TemplateRanking.tsx` | 신규 ~60줄 | 성과 테이블 |
| 8 | `src/components/dashboard/AnalyticsSection.tsx` | 신규 ~120줄 | 분석 섹션 컨테이너 |
| 9 | `src/components/dashboard/HomeDashboard.tsx` | 수정 ~3줄 | import + 렌더 |

## 5. 사용하지 않는 것

- DateRangePicker (커스텀 날짜): 프리셋(7d/30d/90d)만
- 파티션별/워크스페이스별 필터: 조직 전체 기준
- 빈 날짜 채움: API가 데이터 있는 날짜만 반환, 차트에서 자동 연결
- 실시간 WebSocket: SWR refreshInterval 60초로 충분
- PDF/이미지 내보내기
- 커스텀 대시보드 위젯 드래그앤드롭

## 6. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| 1 | `npx next build` 성공 | 빌드 실행 |
| 2 | 홈 대시보드에 "발송 분석" 섹션 표시 | 로그인 후 메인 페이지 |
| 3 | 기간 선택 (7일/30일/90일) 동작 | 버튼 클릭 시 데이터 갱신 |
| 4 | 채널 필터 (전체/알림톡/이메일) 동작 | Select 변경 시 차트/테이블 변경 |
| 5 | 일별 추이 차트 렌더링 | 4개 시리즈 (알림톡 성공/실패, 이메일 성공/실패) |
| 6 | 채널 요약 카드 3개 | 알림톡 합계/이메일 합계/신규 레코드 |
| 7 | 성공률 % 표시 | 채널 요약 카드 subtitle |
| 8 | 템플릿 Top 10 테이블 | 순위, 이름, 채널 Badge, 전체/성공/실패/성공률 |
| 9 | 발송 이력 없는 조직 | 빈 상태 메시지 표시 (차트/테이블 각각) |
| 10 | 로딩 상태 | isLoading 중 "-" 또는 "로딩 중..." |
