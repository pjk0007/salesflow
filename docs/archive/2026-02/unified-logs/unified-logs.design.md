# Design: unified-logs — 통합 발송 이력

> **Plan 문서**: [unified-logs.plan.md](../../01-plan/features/unified-logs.plan.md)

## 1. 개요

알림톡 + 이메일 로그를 시간순 UNION ALL 쿼리로 합쳐 보여주는 통합 뷰.
채널/상태/트리거타입/기간 필터 + 검색 + 페이지네이션.
레코드 상세(Sheet)에서 해당 레코드 발송 이력 탭 추가.

## 2. 구현 순서

```
1. src/types/index.ts (수정) — UnifiedLog, UnifiedLogChannel 타입 추가
2. src/pages/api/logs/unified.ts (신규) — UNION ALL 쿼리 API
3. src/hooks/useUnifiedLogs.ts (신규) — SWR 훅
4. src/components/logs/UnifiedLogTable.tsx (신규) — 통합 로그 테이블 + 필터바
5. src/pages/logs.tsx (신규) — 통합 로그 페이지
6. src/components/dashboard/sidebar.tsx (수정) — 사이드바에 "발송 이력" 메뉴 추가
7. src/components/records/RecordDetailDialog.tsx (수정) — 발송 이력 탭 추가
```

## 3. 컴포넌트 설계

### 3.1 src/types/index.ts (수정)

**추가 위치**: `AlimtalkStats` 인터페이스 아래 (line ~334 부근)

```typescript
// 통합 로그 채널
export type UnifiedLogChannel = "alimtalk" | "email";

// 통합 로그
export interface UnifiedLog {
    id: number;
    channel: UnifiedLogChannel;
    orgId: string;
    partitionId: number | null;
    recordId: number | null;
    recipient: string;       // 알림톡: recipientNo, 이메일: recipientEmail
    title: string | null;    // 알림톡: templateName, 이메일: subject
    status: string;          // pending | sent | failed | rejected
    triggerType: string | null;
    resultMessage: string | null;
    sentBy: string | null;
    sentAt: string;
    completedAt: string | null;
}
```

---

### 3.2 src/pages/api/logs/unified.ts (신규)

**패턴**: 기존 `/api/alimtalk/logs/index.ts` 동일 (GET, 인증, pagination, 응답 포맷)

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**쿼리 파라미터 파싱**:
```typescript
const page = Math.max(1, Number(req.query.page) || 1);
const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
const offset = (page - 1) * pageSize;
const channel = (req.query.channel as string) || "";      // "" | "alimtalk" | "email"
const status = (req.query.status as string) || "";         // "" | "pending" | "sent" | "failed" | "rejected"
const triggerType = (req.query.triggerType as string) || "";
const startDate = (req.query.startDate as string) || "";
const endDate = (req.query.endDate as string) || "";
const recordId = req.query.recordId ? Number(req.query.recordId) : null;
const search = (req.query.search as string) || "";
```

**UNION ALL 쿼리 구성 전략**:

WHERE 조건을 각 SELECT 내부에 중복 적용 (PostgreSQL 최적화를 위해 UNION 전 필터):

```typescript
// 공통 WHERE 빌더
function buildWhereClause(orgId: string, table: "alimtalk" | "email"): string[] {
    const conditions: string[] = [];
    conditions.push(`org_id = '${orgId}'`); // 파라미터화는 sql`` 태그 내에서 처리

    if (status) conditions.push(`status = $status`);
    if (triggerType) conditions.push(`trigger_type = $triggerType`);
    if (startDate) conditions.push(`sent_at >= $startDate::timestamptz`);
    if (endDate) conditions.push(`sent_at <= ($endDate::date + interval '1 day')::timestamptz`);
    if (recordId) conditions.push(`record_id = $recordId`);

    if (search) {
        if (table === "alimtalk") {
            conditions.push(`(recipient_no ILIKE $search OR template_name ILIKE $search)`);
        } else {
            conditions.push(`(recipient_email ILIKE $search OR subject ILIKE $search)`);
        }
    }
    return conditions;
}
```

실제 구현은 Drizzle의 `sql` 태그로 파라미터화:

```typescript
// 알림톡 서브쿼리
const alimtalkSelect = sql`
    SELECT id, 'alimtalk'::text as channel, org_id, partition_id, record_id,
           recipient_no as recipient, template_name as title,
           status, trigger_type, result_message, sent_by, sent_at, completed_at
    FROM alimtalk_send_logs
    WHERE org_id = ${user.orgId}
`;

// 이메일 서브쿼리
const emailSelect = sql`
    SELECT id, 'email'::text as channel, org_id, partition_id, record_id,
           recipient_email as recipient, subject as title,
           status, trigger_type, result_message, sent_by, sent_at, completed_at
    FROM email_send_logs
    WHERE org_id = ${user.orgId}
`;
```

**조건부 WHERE 추가** (각 서브쿼리에 동일하게 append):
```typescript
// 헬퍼: sql 조건 누적
function appendConditions(base: ReturnType<typeof sql>, params: {
    status: string; triggerType: string; startDate: string;
    endDate: string; recordId: number | null;
    search: string; searchColumns: [string, string];
}) {
    let q = base;
    if (params.status) q = sql`${q} AND status = ${params.status}`;
    if (params.triggerType) q = sql`${q} AND trigger_type = ${params.triggerType}`;
    if (params.startDate) q = sql`${q} AND sent_at >= ${params.startDate}::timestamptz`;
    if (params.endDate) {
        const endDateObj = new Date(params.endDate);
        endDateObj.setHours(23, 59, 59, 999);
        q = sql`${q} AND sent_at <= ${endDateObj.toISOString()}::timestamptz`;
    }
    if (params.recordId) q = sql`${q} AND record_id = ${params.recordId}`;
    if (params.search) {
        const like = `%${params.search}%`;
        q = sql`${q} AND (${sql.raw(params.searchColumns[0])} ILIKE ${like} OR ${sql.raw(params.searchColumns[1])} ILIKE ${like})`;
    }
    return q;
}
```

**채널 필터**: `channel` === "alimtalk" → alimtalk만, "email" → email만, "" → UNION ALL

```typescript
let dataQuery;
let countQuery;

if (channel === "alimtalk") {
    const q = appendConditions(alimtalkSelect, { ...commonParams, searchColumns: ["recipient_no", "template_name"] });
    dataQuery = sql`SELECT * FROM (${q}) t ORDER BY sent_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    countQuery = sql`SELECT count(*)::int as count FROM (${q}) t`;
} else if (channel === "email") {
    const q = appendConditions(emailSelect, { ...commonParams, searchColumns: ["recipient_email", "subject"] });
    dataQuery = sql`SELECT * FROM (${q}) t ORDER BY sent_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    countQuery = sql`SELECT count(*)::int as count FROM (${q}) t`;
} else {
    const qa = appendConditions(alimtalkSelect, { ...commonParams, searchColumns: ["recipient_no", "template_name"] });
    const qe = appendConditions(emailSelect, { ...commonParams, searchColumns: ["recipient_email", "subject"] });
    const union = sql`(${qa}) UNION ALL (${qe})`;
    dataQuery = sql`SELECT * FROM (${union}) t ORDER BY sent_at DESC LIMIT ${pageSize} OFFSET ${offset}`;
    countQuery = sql`SELECT count(*)::int as count FROM (${union}) t`;
}
```

**실행 및 응답**:
```typescript
const [countResult] = await db.execute(countQuery);
const total = (countResult as { count: number }).count;
const logs = await db.execute(dataQuery);

return res.status(200).json({
    success: true,
    data: logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
});
```

**응답 형태**: `{ success, data: UnifiedLog[], total, page, pageSize, totalPages }` — alimtalk logs API와 동일

---

### 3.3 src/hooks/useUnifiedLogs.ts (신규)

**패턴**: `useAlimtalkLogs.ts` 동일

```typescript
import useSWR from "swr";
import type { UnifiedLog } from "@/types";

interface UseUnifiedLogsParams {
    channel?: string;
    status?: string;
    triggerType?: string;
    startDate?: string;
    endDate?: string;
    recordId?: number | null;
    search?: string;
    page?: number;
    pageSize?: number;
}

interface UnifiedLogsResponse {
    success: boolean;
    data: UnifiedLog[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function buildQueryString(params: UseUnifiedLogsParams): string {
    const qs = new URLSearchParams();
    if (params.channel) qs.set("channel", params.channel);
    if (params.status) qs.set("status", params.status);
    if (params.triggerType) qs.set("triggerType", params.triggerType);
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.recordId) qs.set("recordId", String(params.recordId));
    if (params.search) qs.set("search", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return qs.toString();
}

export function useUnifiedLogs(params: UseUnifiedLogsParams = {}) {
    const queryString = buildQueryString(params);
    const { data, error, isLoading, mutate } = useSWR<UnifiedLogsResponse>(
        `/api/logs/unified?${queryString}`,
        fetcher
    );

    return {
        logs: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 50,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
    };
}
```

---

### 3.4 src/components/logs/UnifiedLogTable.tsx (신규)

**import**:
```typescript
import { useState } from "react";
import { useUnifiedLogs } from "@/hooks/useUnifiedLogs";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
```

**Props**:
```typescript
interface UnifiedLogTableProps {
    recordId?: number;   // RecordDetailDialog에서 사용 시 전달
    compact?: boolean;   // true → 간소화 뷰 (RecordDetailDialog용)
}
```

**상수 맵** (컴포넌트 외부):
```typescript
const CHANNEL_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    alimtalk: { label: "알림톡", variant: "secondary" },
    email: { label: "이메일", variant: "outline" },
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "성공", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    rejected: { label: "거부", variant: "destructive" },
};

const TRIGGER_TYPE_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    manual: { label: "수동", variant: "outline" },
    auto: { label: "자동", variant: "default" },
    repeat: { label: "반복", variant: "secondary" },
};
```

**내부 상태**:
```typescript
const [page, setPage] = useState(1);
const [channel, setChannel] = useState("");
const [status, setStatus] = useState("");
const [triggerType, setTriggerType] = useState("");
const [startDate, setStartDate] = useState("");
const [endDate, setEndDate] = useState("");
const [search, setSearch] = useState("");
const [searchInput, setSearchInput] = useState("");
```

**훅 호출**:
```typescript
const { logs, total, totalPages, isLoading } = useUnifiedLogs({
    channel: channel || undefined,
    status: status || undefined,
    triggerType: triggerType || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    recordId: recordId || undefined,
    search: search || undefined,
    page,
    pageSize: compact ? 20 : 50,
});
```

**검색 핸들러**:
```typescript
const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
};

const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
};
```

**UI 구조 (full 모드, compact=false)**:
```
<div className="space-y-4">
├── 필터바 (compact가 아닐 때만)
│   <div className="flex items-center gap-3 flex-wrap">
│   ├── 채널 Select (w-[120px])
│   │   ├── SelectItem value="all" → "전체"
│   │   ├── SelectItem value="alimtalk" → "알림톡"
│   │   └── SelectItem value="email" → "이메일"
│   ├── 상태 Select (w-[120px])
│   │   ├── SelectItem value="all" → "전체"
│   │   ├── SelectItem value="pending" → "대기"
│   │   ├── SelectItem value="sent" → "성공"
│   │   ├── SelectItem value="failed" → "실패"
│   │   └── SelectItem value="rejected" → "거부"
│   ├── 방식 Select (w-[120px])
│   │   ├── SelectItem value="all" → "전체"
│   │   ├── SelectItem value="manual" → "수동"
│   │   ├── SelectItem value="auto" → "자동"
│   │   └── SelectItem value="repeat" → "반복"
│   ├── 날짜 시작 Input (type="date", w-[160px])
│   ├── "~" span
│   ├── 날짜 종료 Input (type="date", w-[160px])
│   └── 검색 div (flex gap-2)
│       ├── Input (placeholder="수신자/제목 검색", w-[200px])
│       └── Button (variant="outline", size="icon", Search 아이콘)
│   </div>
│
├── 로딩 (isLoading → Skeleton 10개)
├── 빈 상태 (logs.length === 0 → "발송 이력이 없습니다")
└── 데이터
    ├── <div className="border rounded-lg">
    │   <Table>
    │   ├── TableHeader
    │   │   └── TableRow
    │   │       ├── TableHead "채널"
    │   │       ├── TableHead "수신자"
    │   │       ├── TableHead "제목"
    │   │       ├── TableHead "상태"
    │   │       ├── TableHead "방식" (compact가 아닐 때만)
    │   │       ├── TableHead "발송일시"
    │   │       └── TableHead "결과" (compact가 아닐 때만)
    │   └── TableBody
    │       └── logs.map(log =>
    │           <TableRow key={`${log.channel}-${log.id}`}>
    │           ├── Badge (CHANNEL_MAP)
    │           ├── recipient (font-mono text-sm)
    │           ├── title (max-w-[200px] truncate)
    │           ├── Badge (STATUS_MAP)
    │           ├── Badge (TRIGGER_TYPE_MAP) — compact가 아닐 때만
    │           ├── sentAt (toLocaleString "ko-KR")
    │           └── resultMessage (text-xs truncate) — compact가 아닐 때만
    │           </TableRow>)
    │   </Table>
    │   </div>
    │
    └── 페이지네이션 (totalPages > 1)
        <div className="flex items-center justify-between">
        ├── "총 {total.toLocaleString()}건" (text-sm text-muted-foreground)
        └── <div className="flex items-center gap-1">
            ├── Button prev (ChevronLeft)
            ├── "{page} / {totalPages}"
            └── Button next (ChevronRight)
        </div>
</div>
```

**compact 모드 (RecordDetailDialog용)**:
- 필터바 숨김
- "방식", "결과" 컬럼 숨김
- pageSize = 20

---

### 3.5 src/pages/logs.tsx (신규)

**패턴**: 기존 페이지 패턴 (WorkspaceLayout 사용)

```typescript
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import UnifiedLogTable from "@/components/logs/UnifiedLogTable";

export default function LogsPage() {
    return (
        <WorkspaceLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">발송 이력</h1>
                    <p className="text-muted-foreground">알림톡/이메일 통합 발송 이력</p>
                </div>
                <UnifiedLogTable />
            </div>
        </WorkspaceLayout>
    );
}
```

---

### 3.6 src/components/dashboard/sidebar.tsx (수정)

**변경 내용**: navItems에 "발송 이력" 추가

**import 추가**: `History` (lucide-react)
```typescript
import {
    Home, Table2, MessageSquare, Users, Mail, Settings,
    PanelLeftClose, PanelLeftOpen, X,
    History,  // 추가
} from "lucide-react";
```

**navItems 수정** (이메일 다음에 추가):
```typescript
const navItems = [
    { href: "/", label: "홈", icon: Home },
    { href: "/records", label: "레코드", icon: Table2 },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
    { href: "/logs", label: "발송 이력", icon: History },  // 추가
];
```

**변경 범위**: import 1줄 + navItems 1줄

---

### 3.7 src/components/records/RecordDetailDialog.tsx (수정)

**변경 내용**: 기존 필드 목록 아래에 "발송 이력" 섹션 추가

**import 추가**:
```typescript
import UnifiedLogTable from "@/components/logs/UnifiedLogTable";
```

**UI 추가** (필드 목록 div 아래, SheetFooter 위에):
```tsx
{/* 발송 이력 */}
<div className="space-y-2">
    <h3 className="text-sm font-medium text-muted-foreground">발송 이력</h3>
    <UnifiedLogTable recordId={record.id} compact />
</div>
```

**변경 범위**: import 1줄 + JSX ~5줄

## 4. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `src/types/index.ts` | 수정 ~15줄 | UnifiedLogChannel, UnifiedLog 타입 |
| 2 | `src/pages/api/logs/unified.ts` | 신규 ~100줄 | UNION ALL 쿼리, 필터/페이지네이션 |
| 3 | `src/hooks/useUnifiedLogs.ts` | 신규 ~50줄 | SWR 훅 |
| 4 | `src/components/logs/UnifiedLogTable.tsx` | 신규 ~200줄 | 통합 로그 테이블 + 필터바 |
| 5 | `src/pages/logs.tsx` | 신규 ~20줄 | 통합 로그 페이지 |
| 6 | `src/components/dashboard/sidebar.tsx` | 수정 ~2줄 | navItems에 "발송 이력" 추가 |
| 7 | `src/components/records/RecordDetailDialog.tsx` | 수정 ~6줄 | 발송 이력 섹션 추가 |

## 5. 사용하지 않는 것

- 새 DB 테이블/컬럼: 없음 (기존 테이블 UNION 조회만)
- 새 외부 라이브러리: 없음
- 결과 동기화 (sync) 기능: 통합 뷰에서는 제외 (기존 개별 페이지에서 사용)
- Tabs 컴포넌트: RecordDetailDialog에서 Tabs 대신 섹션으로 표시 (Sheet 내 Tabs는 복잡도 증가)
- 기존 개별 로그 페이지 변경: 없음 (유지)

## 6. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| 1 | `npx next build` 성공 | 빌드 실행 |
| 2 | /logs 페이지 접근 → 통합 로그 테이블 표시 | URL 접근 |
| 3 | 채널 필터 (알림톡만, 이메일만) → 올바른 결과 | Select 변경 |
| 4 | 상태 필터 (sent, failed 등) → 올바른 결과 | Select 변경 |
| 5 | 방식 필터 (수동, 자동, 반복) → 올바른 결과 | Select 변경 |
| 6 | 날짜 범위 필터 → 해당 기간 로그만 표시 | 날짜 입력 |
| 7 | 검색 (수신자/제목) → 올바른 결과 | 검색어 입력 |
| 8 | 페이지네이션 동작 | 이전/다음 버튼 |
| 9 | 복합 필터 (채널 + 상태 + 기간 동시) | 여러 필터 조합 |
| 10 | 사이드바 "발송 이력" 메뉴 클릭 → /logs 이동 | 네비게이션 |
| 11 | 레코드 상세에서 해당 레코드 발송 이력 표시 | RecordDetailDialog 열기 |
| 12 | compact 모드에서 간소화된 컬럼 | RecordDetailDialog 내 테이블 확인 |
| 13 | 총 건수 표시 + 페이지 정보 | 페이지네이션 영역 |
| 14 | 채널 Badge (알림톡/이메일), 상태 Badge 색상 | 테이블 셀 확인 |
