# Design: dashboard-home — 홈 대시보드

## 1. 구현 순서

| 순서 | 항목 | 설명 |
|:----:|------|------|
| 1 | API 엔드포인트 | `/api/dashboard/summary` — 통합 통계 |
| 2 | SWR 훅 | `useDashboardSummary` |
| 3 | 레코드 페이지 이동 | `index.tsx` → `records.tsx` |
| 4 | 대시보드 컴포넌트 | `HomeDashboard.tsx` |
| 5 | 홈 페이지 | `index.tsx` 교체 |
| 6 | 사이드바 수정 | 네비게이션 항목 추가 |

---

## 2. API 설계

### GET /api/dashboard/summary

**파일**: `src/pages/api/dashboard/summary.ts`

**인증**: `getUserFromRequest()` — orgId 기반 데이터 조회

**응답 타입**:
```typescript
interface DashboardSummaryResponse {
    success: true;
    data: {
        recordCount: number;
        workspaceCount: number;
        partitionCount: number;
        alimtalk: {
            total: number;
            sent: number;
            failed: number;
            pending: number;
        };
        email: {
            total: number;
            sent: number;
            failed: number;
            pending: number;
        };
        recentAlimtalkLogs: Array<{
            id: number;
            recipientNo: string;
            templateName: string | null;
            status: string;
            sentAt: string;
        }>;
        recentEmailLogs: Array<{
            id: number;
            recipientEmail: string;
            subject: string | null;
            status: string;
            sentAt: string;
        }>;
    };
}
```

**DB 쿼리 설계** (5개 쿼리, 병렬 실행):

```typescript
// 1. 레코드 수
db.select({ count: sql<number>`count(*)::int` })
  .from(records)
  .where(eq(records.orgId, orgId));

// 2. 워크스페이스 수 + 파티션 수
db.select({ count: sql<number>`count(*)::int` })
  .from(workspaces)
  .where(eq(workspaces.orgId, orgId));

db.select({ count: sql<number>`count(*)::int` })
  .from(partitions)
  .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
  .where(eq(workspaces.orgId, orgId));

// 3. 알림톡 통계 (오늘)
db.select({
    status: alimtalkSendLogs.status,
    count: sql<number>`count(*)::int`,
  })
  .from(alimtalkSendLogs)
  .where(and(
    eq(alimtalkSendLogs.orgId, orgId),
    gte(alimtalkSendLogs.sentAt, todayStart)
  ))
  .groupBy(alimtalkSendLogs.status);

// 4. 이메일 통계 (오늘)
db.select({
    status: emailSendLogs.status,
    count: sql<number>`count(*)::int`,
  })
  .from(emailSendLogs)
  .where(and(
    eq(emailSendLogs.orgId, orgId),
    gte(emailSendLogs.sentAt, todayStart)
  ))
  .groupBy(emailSendLogs.status);

// 5. 최근 알림톡 로그 5건
db.select({
    id: alimtalkSendLogs.id,
    recipientNo: alimtalkSendLogs.recipientNo,
    templateName: alimtalkSendLogs.templateName,
    status: alimtalkSendLogs.status,
    sentAt: alimtalkSendLogs.sentAt,
  })
  .from(alimtalkSendLogs)
  .where(eq(alimtalkSendLogs.orgId, orgId))
  .orderBy(sql`${alimtalkSendLogs.sentAt} DESC`)
  .limit(5);

// 6. 최근 이메일 로그 5건
db.select({
    id: emailSendLogs.id,
    recipientEmail: emailSendLogs.recipientEmail,
    subject: emailSendLogs.subject,
    status: emailSendLogs.status,
    sentAt: emailSendLogs.sentAt,
  })
  .from(emailSendLogs)
  .where(eq(emailSendLogs.orgId, orgId))
  .orderBy(sql`${emailSendLogs.sentAt} DESC`)
  .limit(5);
```

`Promise.all()`로 병렬 실행하여 응답 속도 최적화.

---

## 3. SWR 훅

### useDashboardSummary

**파일**: `src/hooks/useDashboardSummary.ts`

```typescript
import useSWR from "swr";

interface DashboardSummary {
    recordCount: number;
    workspaceCount: number;
    partitionCount: number;
    alimtalk: { total: number; sent: number; failed: number; pending: number };
    email: { total: number; sent: number; failed: number; pending: number };
    recentAlimtalkLogs: Array<{
        id: number;
        recipientNo: string;
        templateName: string | null;
        status: string;
        sentAt: string;
    }>;
    recentEmailLogs: Array<{
        id: number;
        recipientEmail: string;
        subject: string | null;
        status: string;
        sentAt: string;
    }>;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDashboardSummary() {
    const { data, error, isLoading } = useSWR<{ success: boolean; data?: DashboardSummary }>(
        "/api/dashboard/summary",
        fetcher,
        { refreshInterval: 60000 }  // 1분마다 갱신
    );

    const empty: DashboardSummary = {
        recordCount: 0, workspaceCount: 0, partitionCount: 0,
        alimtalk: { total: 0, sent: 0, failed: 0, pending: 0 },
        email: { total: 0, sent: 0, failed: 0, pending: 0 },
        recentAlimtalkLogs: [],
        recentEmailLogs: [],
    };

    return {
        summary: data?.data ?? empty,
        isLoading,
        error,
    };
}
```

---

## 4. 컴포넌트 설계

### 4.1 HomeDashboard

**파일**: `src/components/dashboard/HomeDashboard.tsx`

최상위 대시보드 컴포넌트. 3개 섹션으로 구성.

```
┌───────────────────────────────────────────────┐
│  홈 대시보드                                    │
├───────────┬───────────┬───────────┬───────────┤
│ 레코드 수  │ 워크스페이스│ 알림톡(오늘)│ 이메일(오늘)│
│   123     │    3      │   45/2/1  │   30/1/0  │
├───────────┴───────────┴───────────┴───────────┤
│                                               │
│  ┌─── 최근 알림톡 ─────┐ ┌─── 최근 이메일 ────┐ │
│  │ 발송일시 | 수신 | 상태│ │ 발송일시 | 수신 | 상태│ │
│  │ ...5건...          │ │ ...5건...          │ │
│  └────────────────────┘ └────────────────────┘ │
│                                               │
│  [레코드 관리] [알림톡] [이메일]                  │
└───────────────────────────────────────────────┘
```

**Props**: 없음 (useDashboardSummary 훅 사용)

**구조**:
```tsx
export default function HomeDashboard() {
    const { summary, isLoading } = useDashboardSummary();

    return (
        <div className="space-y-6">
            {/* 통계 카드 영역 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="전체 레코드" value={summary.recordCount} icon={Users} color="text-blue-600" />
                <StatCard label="워크스페이스" value={summary.workspaceCount} icon={LayoutGrid} color="text-purple-600" />
                <StatCard label="알림톡 (오늘)" value={`${summary.alimtalk.sent}/${summary.alimtalk.failed}`}
                          subtitle={`전체 ${summary.alimtalk.total}건`} icon={MessageSquare} color="text-green-600" />
                <StatCard label="이메일 (오늘)" value={`${summary.email.sent}/${summary.email.failed}`}
                          subtitle={`전체 ${summary.email.total}건`} icon={Mail} color="text-orange-600" />
            </div>

            {/* 최근 활동 영역 */}
            <div className="grid md:grid-cols-2 gap-6">
                <RecentLogsCard title="최근 알림톡" logs={summary.recentAlimtalkLogs} type="alimtalk" />
                <RecentLogsCard title="최근 이메일" logs={summary.recentEmailLogs} type="email" />
            </div>

            {/* 빠른 액션 */}
            <QuickActions />
        </div>
    );
}
```

### 4.2 StatCard (인라인 컴포넌트)

HomeDashboard 내 로컬 컴포넌트. 기존 AlimtalkDashboard의 카드 스타일 재사용.

```tsx
function StatCard({ label, value, subtitle, icon: Icon, color, isLoading }: {
    label: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    color: string;
    isLoading?: boolean;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`text-2xl font-bold ${color}`}>
                            {isLoading ? "-" : value}
                        </p>
                        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                    </div>
                    <Icon className={`h-8 w-8 ${color} opacity-20`} />
                </div>
            </CardContent>
        </Card>
    );
}
```

### 4.3 RecentLogsCard (인라인 컴포넌트)

알림톡/이메일 공용. `type` prop으로 분기.

```tsx
function RecentLogsCard({ title, logs, type }: {
    title: string;
    logs: Array<{ id: number; status: string; sentAt: string; [key: string]: unknown }>;
    type: "alimtalk" | "email";
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                        아직 발송 이력이 없습니다.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>발송일시</TableHead>
                                <TableHead>{type === "alimtalk" ? "수신번호" : "수신이메일"}</TableHead>
                                <TableHead>{type === "alimtalk" ? "템플릿" : "제목"}</TableHead>
                                <TableHead>상태</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell className="text-sm">
                                        {new Date(log.sentAt).toLocaleString("ko-KR")}
                                    </TableCell>
                                    <TableCell className="text-sm font-mono">
                                        {type === "alimtalk"
                                            ? (log as { recipientNo: string }).recipientNo
                                            : (log as { recipientEmail: string }).recipientEmail}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {type === "alimtalk"
                                            ? (log as { templateName: string }).templateName
                                            : (log as { subject: string }).subject}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={statusVariant(log.status)}>
                                            {statusLabel(log.status)}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
```

**상태 매핑** (기존 AlimtalkDashboard 패턴):
```typescript
const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "성공", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    rejected: { label: "거부", variant: "destructive" },
};
```

### 4.4 QuickActions (인라인 컴포넌트)

```tsx
function QuickActions() {
    return (
        <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
                <Link href="/records"><TableIcon className="h-4 w-4 mr-2" />레코드 관리</Link>
            </Button>
            <Button variant="outline" asChild>
                <Link href="/alimtalk"><MessageSquare className="h-4 w-4 mr-2" />알림톡</Link>
            </Button>
            <Button variant="outline" asChild>
                <Link href="/email"><Mail className="h-4 w-4 mr-2" />이메일</Link>
            </Button>
        </div>
    );
}
```

---

## 5. 페이지 변경

### 5.1 records.tsx (신규)

**파일**: `src/pages/records.tsx`

기존 `index.tsx`의 내용을 그대로 이동. 함수명만 `RecordsPage`로 변경.

```tsx
// 기존 index.tsx 내용 전체 복사
// export default function HomePage() → export default function RecordsPage()
```

### 5.2 index.tsx (수정)

**파일**: `src/pages/index.tsx`

```tsx
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import HomeDashboard from "@/components/dashboard/HomeDashboard";

export default function HomePage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="홈"
                    description="전체 현황을 한눈에 확인하세요."
                />
                <HomeDashboard />
            </PageContainer>
        </WorkspaceLayout>
    );
}
```

---

## 6. 사이드바 수정

**파일**: `src/components/dashboard/sidebar.tsx`

```typescript
// 변경 전
const navItems = [
    { href: "/", label: "레코드", icon: LayoutDashboard },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
];

// 변경 후
import { Home, Table2 } from "lucide-react";  // 추가 import

const navItems = [
    { href: "/", label: "홈", icon: Home },
    { href: "/records", label: "레코드", icon: Table2 },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
];
```

`LayoutDashboard` 아이콘은 더 이상 사용하지 않으므로 import에서 제거.

---

## 7. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `src/pages/api/dashboard/summary.ts` | 신규 | 통합 통계 API (6쿼리 병렬) |
| 2 | `src/hooks/useDashboardSummary.ts` | 신규 | SWR 훅, 60초 갱신 |
| 3 | `src/pages/records.tsx` | 신규 | 기존 index.tsx 이동 |
| 4 | `src/components/dashboard/HomeDashboard.tsx` | 신규 | StatCard + RecentLogsCard + QuickActions |
| 5 | `src/pages/index.tsx` | 수정 | 홈 대시보드 페이지 |
| 6 | `src/components/dashboard/sidebar.tsx` | 수정 | navItems: 홈 + 레코드 분리 |

---

## 8. 검증 기준

- [ ] `npx next build` 성공
- [ ] `/` 접속 시 홈 대시보드 표시
- [ ] `/records` 접속 시 기존 레코드 관리 동작
- [ ] 통계 카드에 레코드 수, 알림톡/이메일 발송 현황 표시
- [ ] 최근 활동에 알림톡 5건, 이메일 5건 표시
- [ ] 빠른 액션 링크 3개 정상 동작
- [ ] 사이드바에 "홈" / "레코드" 분리 표시
- [ ] 데이터 없을 때 빈 상태 처리
- [ ] SWR 60초 자동 갱신 동작
