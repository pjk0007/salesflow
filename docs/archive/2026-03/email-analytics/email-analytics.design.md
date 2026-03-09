# Design: email-analytics (발송 결과 분석)

> Plan: [email-analytics.plan.md](../../01-plan/features/email-analytics.plan.md)

## 1. 아키텍처 변경

### 변경 전
```
EmailDashboard → useEmailLogs() → GET /api/email/logs
                                      ↓
                  클라이언트에서 logs.filter()로 sent/failed/pending 카운트
                  (읽음률/triggerType 분석 없음)
```

### 변경 후
```
EmailDashboard → useEmailAnalytics(startDate, endDate)
                      ↓
                  GET /api/analytics/summary?startDate=...&endDate=...
                      ↓ (응답에 openedCount, openRate, triggerBreakdown 추가)
                  +
                  GET /api/analytics/trends?startDate=...&endDate=...&channel=email
                      ↓ (응답에 emailOpened 추가)
                  →  읽음률 카드 + triggerType 테이블 + 일별 추세 차트 렌더
```

## 2. API 변경

### 2-1. `/api/analytics/summary` — 읽음률 + triggerType별 breakdown 추가

**기존 email 쿼리** (status별 count만):
```sql
SELECT status, count(*)::int FROM email_send_logs
WHERE org_id = ? AND sent_at BETWEEN ? AND ?
GROUP BY status
```

**변경: 읽음 카운트 + triggerType별 breakdown 병렬 추가**

```typescript
// 기존 emailStats 쿼리에 opened 추가
const emailStats = await db.select({
    status: emailSendLogs.status,
    count: sql<number>`count(*)::int`,
    opened: sql<number>`count(*) filter (where ${emailSendLogs.isOpened} = 1)::int`,
}).from(emailSendLogs)
  .where(and(eq(emailSendLogs.orgId, orgId), gte(emailSendLogs.sentAt, start), lte(emailSendLogs.sentAt, end)))
  .groupBy(emailSendLogs.status);

// triggerType별 breakdown (신규 쿼리)
const triggerBreakdown = await db.select({
    triggerType: emailSendLogs.triggerType,
    total: sql<number>`count(*)::int`,
    sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`,
    failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`,
    opened: sql<number>`count(*) filter (where ${emailSendLogs.isOpened} = 1)::int`,
}).from(emailSendLogs)
  .where(and(eq(emailSendLogs.orgId, orgId), gte(emailSendLogs.sentAt, start), lte(emailSendLogs.sentAt, end)))
  .groupBy(emailSendLogs.triggerType);
```

**응답 변경:**
```json
{
  "data": {
    "email": {
      "total": 1000,
      "sent": 950,
      "failed": 30,
      "pending": 20,
      "opened": 320,
      "openRate": 33.7
    },
    "alimtalk": { ... },
    "newRecordsInPeriod": 150,
    "triggerBreakdown": [
      {
        "triggerType": "auto_personalized",
        "total": 500,
        "sent": 480,
        "failed": 10,
        "opened": 200,
        "successRate": 96.0,
        "openRate": 41.7
      },
      {
        "triggerType": "manual",
        "total": 300,
        "sent": 290,
        "failed": 5,
        "opened": 80,
        "successRate": 96.7,
        "openRate": 27.6
      }
    ]
  }
}
```

**aggregateStats 수정:**
```typescript
function aggregateStats(rows: Array<{ status: string; count: number; opened: number }>) {
    let total = 0, sent = 0, failed = 0, pending = 0, opened = 0;
    for (const row of rows) {
        total += row.count;
        opened += row.opened;
        if (row.status === "sent") sent = row.count;
        else if (row.status === "failed" || row.status === "rejected") failed += row.count;
        else if (row.status === "pending") pending = row.count;
    }
    const openRate = sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0;
    return { total, sent, failed, pending, opened, openRate };
}
```

### 2-2. `/api/analytics/trends` — 일별 읽음 건수 추가

**이메일 쿼리에 opened 컬럼 추가:**
```typescript
const emailTrends = await db.select({
    date: sql<string>`date_trunc('day', ${emailSendLogs.sentAt})::date::text`.as("date"),
    sent: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`.as("sent"),
    failed: sql<number>`count(*) filter (where ${emailSendLogs.status} in ('failed', 'rejected'))::int`.as("failed"),
    opened: sql<number>`count(*) filter (where ${emailSendLogs.isOpened} = 1)::int`.as("opened"),
}).from(emailSendLogs)
  .where(...)
  .groupBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`)
  .orderBy(sql`date_trunc('day', ${emailSendLogs.sentAt})`);
```

**Map 타입 + 응답에 emailOpened 추가:**
```typescript
const map = new Map<string, {
    date: string;
    alimtalkSent: number;
    alimtalkFailed: number;
    emailSent: number;
    emailFailed: number;
    emailOpened: number;  // 신규
}>();
```

## 3. SWR Hook

### 3-1. `src/hooks/useEmailAnalytics.ts` (신규)

```typescript
import useSWR from "swr";

interface EmailAnalyticsSummary {
    email: {
        total: number; sent: number; failed: number; pending: number;
        opened: number; openRate: number;
    };
    alimtalk: {
        total: number; sent: number; failed: number; pending: number;
    };
    newRecordsInPeriod: number;
    triggerBreakdown: Array<{
        triggerType: string;
        total: number; sent: number; failed: number; opened: number;
        successRate: number; openRate: number;
    }>;
}

interface TrendItem {
    date: string;
    emailSent: number;
    emailFailed: number;
    emailOpened: number;
    alimtalkSent: number;
    alimtalkFailed: number;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useEmailAnalytics(startDate: string, endDate: string) {
    const { data: summaryData, isLoading: summaryLoading } = useSWR<{ success: boolean; data: EmailAnalyticsSummary }>(
        `/api/analytics/summary?startDate=${startDate}&endDate=${endDate}`,
        fetcher
    );
    const { data: trendsData, isLoading: trendsLoading } = useSWR<{ success: boolean; data: TrendItem[] }>(
        `/api/analytics/trends?startDate=${startDate}&endDate=${endDate}&channel=email`,
        fetcher
    );

    return {
        summary: summaryData?.data ?? null,
        trends: trendsData?.data ?? [],
        isLoading: summaryLoading || trendsLoading,
    };
}
```

## 4. UI 변경

### 4-1. `src/components/email/EmailDashboard.tsx` — 수정

**기존:** useEmailLogs()로 클라이언트 필터링, 4개 카드
**변경:** useEmailAnalytics()로 서버 집계, 5개 카드 + triggerType 테이블 + 추세 차트

#### 레이아웃

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ 전체발송 │ │  성공    │ │  실패   │ │  대기   │ │ 읽음률  │
│  1,000  │ │   950   │ │   30    │ │   20    │ │ 33.7%  │
│         │ │ 95.0%   │ │  3.0%   │ │  2.0%   │ │320/950 │
└─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘

┌─────────────────────────────────────────────────────────────┐
│ triggerType별 성과                                           │
│ ┌───────────────┬──────┬──────┬──────┬───────┬──────┐      │
│ │ 발송 유형     │ 발송 │ 성공 │ 실패 │성공률 │읽음률│      │
│ ├───────────────┼──────┼──────┼──────┼───────┼──────┤      │
│ │ AI 자동발송   │  500 │  480 │   10 │ 96.0% │41.7% │      │
│ │ 수동 발송     │  300 │  290 │    5 │ 96.7% │27.6% │      │
│ │ 자동화        │  150 │  140 │   10 │ 93.3% │30.0% │      │
│ │ 반복          │   50 │   40 │    5 │ 80.0% │25.0% │      │
│ └───────────────┴──────┴──────┴──────┴───────┴──────┘      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 일별 추세 (최근 30일)                    [7일][30일][90일]  │
│                                                             │
│  ▄                                                          │
│ ▄█▄   ▄                        ━━ 발송 (sent)             │
│▄███▄ ▄█▄  ▄▄                   ━━ 읽음 (opened)           │
│██████▄███▄████▄▄▄▄              ━━ 실패 (failed)           │
│ 3/1  3/5  3/10 3/15  3/20                                  │
└─────────────────────────────────────────────────────────────┘

[템플릿 관리] [연결 관리] [발송 이력]
```

#### triggerType 한글 라벨

```typescript
const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동 발송",
    on_create: "자동화 (생성)",
    on_update: "자동화 (수정)",
    repeat: "반복 발송",
    auto_personalized: "AI 자동발송",
};
```

#### 기간 선택 (기본 30일)

```typescript
const PERIOD_PRESETS = [
    { label: "7일", days: 7 },
    { label: "30일", days: 30 },
    { label: "90일", days: 90 },
];
```

기본값: 30일. 오늘 날짜 기준 startDate/endDate 계산.

#### 추세 차트 (recharts)

```tsx
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";

<ResponsiveContainer width="100%" height={300}>
    <LineChart data={trends}>
        <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="emailSent" name="발송" stroke="#3b82f6" />
        <Line type="monotone" dataKey="emailOpened" name="읽음" stroke="#10b981" />
        <Line type="monotone" dataKey="emailFailed" name="실패" stroke="#ef4444" />
    </LineChart>
</ResponsiveContainer>
```

## 5. 변경 파일 목록

| # | 파일 | 작업 | 설명 |
|---|------|------|------|
| 1 | `src/app/api/analytics/summary/route.ts` | 수정 | opened 카운트 + triggerBreakdown 추가 |
| 2 | `src/app/api/analytics/trends/route.ts` | 수정 | emailOpened 필드 추가 |
| 3 | `src/hooks/useEmailAnalytics.ts` | 신규 | summary + trends 통합 SWR hook |
| 4 | `src/components/email/EmailDashboard.tsx` | 수정 | 5카드 + triggerType 테이블 + 차트 |

## 6. 구현 순서

| # | 작업 | 파일 |
|---|------|------|
| 1 | summary API에 opened + triggerBreakdown 추가 | summary/route.ts |
| 2 | trends API에 emailOpened 추가 | trends/route.ts |
| 3 | useEmailAnalytics hook 생성 | useEmailAnalytics.ts |
| 4 | EmailDashboard 개편 (카드 + 테이블 + 차트) | EmailDashboard.tsx |
| 5 | 빌드 검증 | `npx next build` |

## 7. 비기능 요구사항

- DB 쿼리: 기존 인덱스(`org_id`, `sent_at`) 활용, 추가 인덱스 불필요
- 대시보드 로딩: summary + trends 2개 API 병렬 호출 (SWR)
- 새 파일 1개만 추가 (useEmailAnalytics.ts), 나머지는 기존 파일 수정
- recharts 이미 설치됨 (^3.7.0)
