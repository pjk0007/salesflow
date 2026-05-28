import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useApiTokens } from "@/hooks/useApiTokens";
import { useSession } from "@/contexts/SessionContext";
import ApiTokenCreateDialog from "./ApiTokenCreateDialog";
import { Plus, MoreHorizontal, Pencil, Trash2, Copy, Check, ChevronDown, Database, MessageSquare } from "lucide-react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "-";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}일 전`;
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "무제한";
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function ApiTokensTab() {
    const { user } = useSession();
    const { tokens, isLoading, createToken, updateToken, deleteToken } = useApiTokens();
    const canEdit = user?.role === "owner" || user?.role === "admin";

    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editToken, setEditToken] = useState<(typeof tokens)[0] | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [createdToken, setCreatedToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleCreate = async (input: Parameters<typeof createToken>[0]) => {
        const result = await createToken(input);
        if (result.success && result.data?.token) {
            setCreatedToken(result.data.token);
            toast.success("토큰이 생성되었습니다.");
        }
        return result;
    };

    const handleEdit = async (input: Parameters<typeof createToken>[0]) => {
        if (!editToken) return { success: false };
        const result = await updateToken(editToken.id, {
            name: input.name,
            scopes: input.scopes,
        });
        if (result.success) {
            toast.success("토큰이 수정되었습니다.");
        }
        return result;
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteToken(deleteTarget);
        if (result.success) {
            toast.success("토큰이 삭제되었습니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
        setDeleteTarget(null);
    };

    const handleToggleActive = async (id: number, currentActive: number) => {
        const result = await updateToken(id, { isActive: currentActive === 1 ? 0 : 1 });
        if (result.success) {
            toast.success(currentActive === 1 ? "토큰이 비활성화되었습니다." : "토큰이 활성화되었습니다.");
        }
    };

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle>API 토큰</CardTitle>
                        <CardDescription>외부 시스템에서 레코드 데이터에 접근하기 위한 API 토큰을 관리합니다.</CardDescription>
                    </div>
                    {canEdit && (
                        <Button onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            토큰 생성
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    {tokens.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            등록된 API 토큰이 없습니다.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>이름</TableHead>
                                    <TableHead>토큰</TableHead>
                                    <TableHead>권한</TableHead>
                                    <TableHead>마지막 사용</TableHead>
                                    <TableHead>만료</TableHead>
                                    <TableHead>상태</TableHead>
                                    {canEdit && <TableHead className="w-10" />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tokens.map((token) => (
                                    <TableRow key={token.id}>
                                        <TableCell className="font-medium">{token.name}</TableCell>
                                        <TableCell>
                                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                                {token.tokenPreview}
                                            </code>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {token.scopes.length}개 범위
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatRelativeTime(token.lastUsedAt)}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatDate(token.expiresAt)}
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={token.isActive === 1}
                                                onCheckedChange={() => handleToggleActive(token.id, token.isActive)}
                                                disabled={!canEdit}
                                            />
                                        </TableCell>
                                        {canEdit && (
                                            <TableCell>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditToken(token)}>
                                                            <Pencil className="h-4 w-4 mr-2" />
                                                            수정
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => setDeleteTarget(token.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                            삭제
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* API 문서 */}
            <ApiDocsCard />

            {/* MCP 연동 가이드 */}
            <McpGuideCard />

            {/* 생성 다이얼로그 */}
            <ApiTokenCreateDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                mode="create"
                onSubmit={handleCreate}
            />

            {/* 수정 다이얼로그 */}
            {editToken && (
                <ApiTokenCreateDialog
                    open={!!editToken}
                    onOpenChange={(open) => !open && setEditToken(null)}
                    mode="edit"
                    token={editToken}
                    onSubmit={handleEdit}
                />
            )}

            {/* 삭제 확인 */}
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>토큰을 삭제하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription>
                            삭제된 토큰은 즉시 비활성화되며, 이 토큰을 사용하는 외부 시스템은 더 이상 접근할 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 생성된 토큰 표시 */}
            <AlertDialog open={createdToken !== null} onOpenChange={(open) => !open && setCreatedToken(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>토큰이 생성되었습니다</AlertDialogTitle>
                        <AlertDialogDescription>
                            이 토큰은 다시 표시되지 않습니다. 안전한 곳에 저장해주세요.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                        <code className="text-sm font-mono flex-1 break-all">{createdToken}</code>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleCopy(createdToken!)}
                        >
                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setCreatedToken(null)}>확인</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

/* ─── API 문서 카드 ─── */

type EndpointParam = { name: string; type: string; required: boolean; desc: string };
type EndpointDef = {
    method: string;
    path: string;
    title: string;
    desc: string;
    params: EndpointParam[] | null;
    body: string | null;
    response: string;
};
type EndpointGroup = {
    id: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    endpoints: EndpointDef[];
};

const RECORD_ENDPOINTS: EndpointDef[] = [
    {
        method: "GET",
        path: "/api/v1/partitions",
        title: "파티션 목록 조회",
        desc: "토큰 권한(scope)에 해당하는 파티션 목록을 조회합니다. 레코드 API 호출 시 필요한 partitionId를 확인할 수 있습니다.",
        params: null,
        body: null,
        response: `{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "영업 리드",
      "workspaceId": 1,
      "workspaceName": "기본 워크스페이스",
      "folderId": null,
      "folderName": null
    }
  ]
}`,
    },
    {
        method: "GET",
        path: "/api/v1/records",
        title: "레코드 목록 조회",
        desc: "파티션 내 레코드를 검색·필터·정렬하여 조회합니다.",
        params: [
            { name: "partitionId", type: "number", required: true, desc: "파티션 ID (필수)" },
            { name: "page", type: "number", required: false, desc: "페이지 번호 (기본 1)" },
            { name: "pageSize", type: "number", required: false, desc: "페이지 크기 (기본 50, 최대 200)" },
            { name: "search", type: "string", required: false, desc: "전체 텍스트 검색어" },
            { name: "sortField", type: "string", required: false, desc: "정렬 필드명" },
            { name: "sortOrder", type: "string", required: false, desc: "asc | desc" },
            { name: "filters", type: "JSON", required: false, desc: "필터 조건 (JSON 문자열)" },
        ],
        body: null,
        response: `{
  "success": true,
  "data": [ { "id": 1, "data": { ... }, ... } ],
  "total": 150,
  "page": 1,
  "pageSize": 50,
  "totalPages": 3
}`,
    },
    {
        method: "POST",
        path: "/api/v1/records",
        title: "레코드 생성 (+ 이벤트 동시 기록)",
        desc: "새 레코드를 생성합니다. 자동 배분·자동 발송 트리거가 실행됩니다. event를 함께 보내면 레코드 생성과 동시에 변경 이력(record_events)에 한 줄 기록됩니다.",
        params: null,
        body: `{
  "partitionId": 1,
  "data": {
    "이름": "홍길동",
    "이메일": "hong@example.com",
    "전화번호": "010-1234-5678"
  },
  "event": {                       // 선택 — 이력 동시 기록
    "type": "consult",            // 이벤트 종류 (자유, 필수)
    "label": "도입상담 신청",      // 표시 라벨 (필수)
    "occurredAt": "2026-05-20T00:00:00Z",  // 선택, 없으면 현재 시각
    "meta": { "source": "website" }         // 선택, 부가 정보
  }
}`,
        response: `{
  "success": true,
  "data": { "id": 42, "data": { ... }, ... },
  "event": { "id": 1, "type": "consult", "label": "도입상담 신청", ... }
}`,
    },
    {
        method: "GET",
        path: "/api/v1/records/:id",
        title: "레코드 단건 조회",
        desc: "레코드 ID로 단건 조회합니다.",
        params: null,
        body: null,
        response: `{
  "success": true,
  "data": { "id": 42, "data": { ... }, ... }
}`,
    },
    {
        method: "PUT",
        path: "/api/v1/records/:id",
        title: "레코드 수정 (+ 이벤트 동시 기록)",
        desc: "레코드 데이터를 부분 업데이트합니다. 기존 데이터와 병합됩니다. event를 함께 보내면 수정과 동시에 변경 이력(record_events)에 기록됩니다.",
        params: null,
        body: `{
  "data": {
    "상태": "계약완료",
    "메모": "3월 계약 체결"
  },
  "event": {                       // 선택 — 이력 동시 기록
    "type": "status",
    "label": "계약완료",
    "meta": { "from": "협상중", "to": "계약완료" }
  }
}`,
        response: `{
  "success": true,
  "data": { "id": 42, "data": { ... }, ... },
  "event": { "id": 2, "type": "status", "label": "계약완료", ... }
}`,
    },
    {
        method: "DELETE",
        path: "/api/v1/records/:id",
        title: "레코드 삭제",
        desc: "레코드를 삭제합니다.",
        params: null,
        body: null,
        response: `{
  "success": true,
  "message": "Record deleted."
}`,
    },
    {
        method: "POST",
        path: "/api/v1/records/:id/events",
        title: "레코드 이벤트 추가",
        desc: "이미 존재하는 레코드에 비즈니스 이벤트(이력)를 추가합니다. 데이터 변경 없이 이벤트만 기록할 때 사용합니다. (생성/수정과 동시에 기록하려면 POST/PUT의 event 옵션을 쓰세요.)",
        params: null,
        body: `{
  "type": "match_stage",       // 이벤트 종류 (자유, 필수)
  "label": "구독중",            // 표시 라벨 (필수)
  "occurredAt": "2026-05-20T00:00:00Z",  // 선택
  "meta": { "from": "테스트", "to": "구독중" }  // 선택
}`,
        response: `{
  "success": true,
  "data": { "id": 3, "recordId": 42, "type": "match_stage", "label": "구독중", ... }
}`,
    },
];

const ALIMTALK_ENDPOINTS: EndpointDef[] = [
    {
        method: "GET",
        path: "/api/v1/alimtalk/templates",
        title: "알림톡 템플릿 목록 조회",
        desc: "조직(org)에 등록된 NHN Cloud 알림톡 템플릿 중 승인 완료(status=TSC03) 상태인 것만 반환합니다. 검수중·반려·중단된 템플릿은 노출되지 않습니다. 본문(templateContent)·강조 영역·버튼·이미지 등 NHN 원본 필드를 모두 포함하여 반환하므로 호출 측에서 미리보기 UI를 자유롭게 구성할 수 있습니다. 변수 치환(#{변수} → 실제값)은 호출 측에서 처리하세요.",
        params: [
            { name: "senderKey", type: "string", required: false, desc: "발신프로필 키. 미지정 시 조직의 기본 발신프로필(defaultSenderKey)이 사용됩니다." },
        ],
        body: null,
        response: `{
  "success": true,
  "data": {
    "senderKey": "abc...",
    "totalCount": 12,
    "templates": [
      {
        "templateCode": "WELCOME_001",
        "templateName": "회원가입 환영",
        "templateContent": "#{고객명}님 가입을 환영합니다.",
        "templateMessageType": "BA",
        "templateEmphasizeType": "TEXT",
        "templateTitle": "환영합니다",
        "templateSubtitle": null,
        "templateHeader": null,
        "templateImageUrl": null,
        "templateExtra": null,
        "buttons": [
          { "ordering": 1, "type": "WL", "name": "홈으로", "linkMo": "https://..." }
        ],
        "quickReplies": [],
        "status": "APR",
        "statusName": "승인",
        "categoryCode": "..."
      }
    ]
  }
}`,
    },
    {
        method: "POST",
        path: "/api/v1/alimtalk/send",
        title: "알림톡 발송",
        desc: "조직에 등록된 NHN Cloud 알림톡 발신프로필을 사용하여 알림톡을 발송합니다. 한 번에 최대 1,000건까지 처리합니다. 전화번호는 하이픈 포함/미포함 모두 허용(서버에서 정규화)되며, 형식이 잘못된 번호는 별도 errors 배열로 반환됩니다. 발송 결과는 alimtalk_send_logs에 자동 저장됩니다.",
        params: null,
        body: `{
  "templateCode": "WELCOME_001",   // 필수, 발신프로필에 승인된 템플릿 코드
  "senderKey": "abc...",            // 선택, 미지정 시 조직 기본 발신프로필 사용
  "recipients": [                    // 필수, 1 ~ 1000건
    {
      "phoneNumber": "010-1234-5678",
      "templateParameter": { "고객명": "홍길동" }  // 선택, 템플릿의 #{변수} 치환값
    }
  ],
  "requestDate": "2026-05-28 14:00",  // 선택, NHN 예약 발송 시각 (yyyy-MM-dd HH:mm)
  "triggerType": "designer-hire-admin" // 선택, 로그에 기록될 발송 출처 라벨
}`,
        response: `{
  "success": true,
  "data": {
    "requestId": "abc-123",
    "totalCount": 1,
    "successCount": 1,
    "failCount": 0,
    "results": [
      {
        "phoneNumber": "010-1234-5678",
        "recipientSeq": 1,
        "status": "sent",
        "resultCode": "0",
        "resultMessage": "success"
      }
    ],
    "errors": [
      // 전화번호 형식 오류 등 NHN 호출 전에 걸러진 건만 포함됨
    ]
  }
}`,
    },
];

const ENDPOINT_GROUPS: EndpointGroup[] = [
    {
        id: "records",
        title: "레코드",
        description: "파티션 내 레코드를 CRUD하고 비즈니스 이벤트(이력)를 기록합니다.",
        icon: Database,
        endpoints: RECORD_ENDPOINTS,
    },
    {
        id: "alimtalk",
        title: "알림톡",
        description: "조직(org)에 등록된 NHN Cloud 알림톡 템플릿을 조회하고 메시지를 발송합니다.",
        icon: MessageSquare,
        endpoints: ALIMTALK_ENDPOINTS,
    },
];

const FILTER_OPERATORS = [
    { op: "contains", desc: "문자열 포함", example: '"홍"' },
    { op: "equals", desc: "정확히 일치", example: '"서울"' },
    { op: "not_equals", desc: "불일치", example: '"서울"' },
    { op: "gt / gte / lt / lte", desc: "숫자 비교", example: "100" },
    { op: "before / after", desc: "날짜 비교", example: '"2026-03-01"' },
    { op: "between", desc: "범위", example: '["2026-01-01","2026-03-31"]' },
    { op: "is_empty / is_not_empty", desc: "빈값 여부", example: "true" },
];

function MethodBadge({ method }: { method: string }) {
    const colors: Record<string, string> = {
        GET: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
        POST: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
        PUT: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        DELETE: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    };
    return (
        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold font-mono ${colors[method] ?? ""}`}>
            {method}
        </span>
    );
}

function CodeBlock({ children }: { children: string }) {
    return (
        <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">
            {children}
        </pre>
    );
}

function McpGuideCard() {
    const [copied, setCopied] = useState(false);

    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://sendb.kr";
    const mcpConfig = `{
  "mcpServers": {
    "sendb": {
      "url": "${baseUrl}/api/mcp",
      "headers": {
        "Authorization": "Bearer <위에서 생성한 API 토큰>"
      }
    }
  }
}`;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(mcpConfig);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    MCP 연동
                    <Badge variant="secondary" className="text-xs">Model Context Protocol</Badge>
                </CardTitle>
                <CardDescription>
                    Claude Desktop, Claude Code 등 AI 도구에서 SalesFlow 데이터에 직접 접근할 수 있습니다.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">1. API 토큰 생성</h4>
                    <p className="text-sm text-muted-foreground">
                        위에서 API 토큰을 생성합니다. MCP를 통해 접근할 워크스페이스/파티션에 대한 권한(scope)을 설정해주세요.
                    </p>
                </div>

                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">2. MCP 설정 추가</h4>
                    <p className="text-sm text-muted-foreground">
                        아래 설정을 AI 도구의 MCP 설정 파일에 추가합니다.
                    </p>
                    <div className="relative">
                        <CodeBlock>{mcpConfig}</CodeBlock>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="absolute top-2 right-2 h-7 px-2"
                            onClick={handleCopy}
                        >
                            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                    </div>
                </div>

                <div className="rounded-md bg-muted/50 border p-3 space-y-1">
                    <p className="text-xs font-semibold">연결이 안 되나요?</p>
                    <p className="text-xs text-muted-foreground">
                        Claude Desktop을 최신 버전으로 업데이트해주세요. (Help → Check for Updates)
                    </p>
                </div>

                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">설정 파일 위치</h4>
                    <div className="rounded-md border text-xs">
                        <table className="w-full table-fixed">
                            <tbody>
                                <tr className="border-b">
                                    <td className="px-2 py-1.5 font-medium whitespace-nowrap w-32 align-top">Claude Desktop</td>
                                    <td className="px-2 py-1.5 text-muted-foreground font-mono break-all">
                                        ~/Library/Application Support/Claude/claude_desktop_config.json
                                    </td>
                                </tr>
                                <tr className="border-b">
                                    <td className="px-2 py-1.5 font-medium whitespace-nowrap w-32 align-top">Claude Code</td>
                                    <td className="px-2 py-1.5 text-muted-foreground font-mono break-all">
                                        ~/.claude/settings.json
                                    </td>
                                </tr>
                                <tr>
                                    <td className="px-2 py-1.5 font-medium whitespace-nowrap w-32 align-top">VS Code (Copilot)</td>
                                    <td className="px-2 py-1.5 text-muted-foreground font-mono break-all">
                                        .vscode/mcp.json
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold hover:text-foreground/80 group">
                        사용 가능한 도구 (10개)
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                        <div className="rounded-md border text-xs">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="px-2 py-1.5 text-left font-medium">도구</th>
                                        <th className="px-2 py-1.5 text-left font-medium">설명</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        { name: "list_workspaces", desc: "워크스페이스 목록 조회" },
                                        { name: "list_partitions", desc: "파티션 목록 조회" },
                                        { name: "list_records", desc: "레코드 목록 조회/검색" },
                                        { name: "get_record", desc: "레코드 상세 조회" },
                                        { name: "create_record", desc: "레코드 생성" },
                                        { name: "update_record", desc: "레코드 수정" },
                                        { name: "delete_record", desc: "레코드 삭제" },
                                        { name: "list_email_logs", desc: "이메일 발송 이력 조회" },
                                        { name: "list_alimtalk_logs", desc: "알림톡 발송 이력 조회" },
                                        { name: "get_analytics", desc: "오늘의 발송 통계 조회" },
                                    ].map((t) => (
                                        <tr key={t.name} className="border-b last:border-0">
                                            <td className="px-2 py-1.5 font-mono font-medium whitespace-nowrap">{t.name}</td>
                                            <td className="px-2 py-1.5 text-muted-foreground">{t.desc}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </CardContent>
        </Card>
    );
}

function ApiDocsCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>API 문서</CardTitle>
                <CardDescription>
                    외부 시스템에서 Sendb의 레코드·알림톡 등을 사용하기 위한 REST API 레퍼런스입니다.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* 인증 */}
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">인증</h4>
                    <p className="text-sm text-muted-foreground">
                        모든 요청에 <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">Authorization</code> 헤더를 포함해야 합니다.
                    </p>
                    <CodeBlock>{`Authorization: Bearer <API_TOKEN>`}</CodeBlock>
                </div>

                {/* 베이스 URL */}
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">베이스 URL</h4>
                    <CodeBlock>{`${typeof window !== "undefined" ? window.location.origin : "https://your-domain.com"}`}</CodeBlock>
                </div>

                {/* 이벤트(변경 이력) - 레코드 API 전용 */}
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">이벤트 (변경 이력) <span className="text-xs font-normal text-muted-foreground">— 레코드 API 전용</span></h4>
                    <p className="text-sm text-muted-foreground">
                        레코드 생성·수정 시 <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">event</code>를
                        함께 보내면 그 레코드의 <strong>변경 이력(타임라인)</strong>이 시간순으로 쌓입니다.
                        단계 변경(예: 테스트→구독중), 도입상담 신청 같은 비즈니스 이벤트를 기록할 때 사용합니다.
                    </p>
                    <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                        <li><code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">POST /records</code> · <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">PUT /records/:id</code> — 레코드 작업과 <strong>동시에</strong> 이력 기록 (한 번의 호출)</li>
                        <li><code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">POST /records/:id/events</code> — 데이터 변경 없이 <strong>이력만</strong> 추가</li>
                    </ul>
                    <p className="text-xs text-muted-foreground">
                        event 구조: <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{`{ type, label, occurredAt?, meta? }`}</code>
                        — <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">type</code>/<code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">label</code>은 필수, 의미는 직접 정의합니다.
                    </p>
                </div>

                {/* 엔드포인트 (그룹별) */}
                <div className="space-y-4">
                    <h4 className="text-sm font-semibold">엔드포인트</h4>
                    {ENDPOINT_GROUPS.map((group) => {
                        const Icon = group.icon;
                        return (
                            <div key={group.id} className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Icon className="size-4 text-muted-foreground" />
                                    <h5 className="text-sm font-semibold">{group.title}</h5>
                                    <span className="text-xs text-muted-foreground">· {group.endpoints.length}개</span>
                                </div>
                                <p className="text-xs text-muted-foreground">{group.description}</p>
                                <div className="space-y-2">
                                    {group.endpoints.map((ep) => (
                                        <Collapsible key={`${ep.method}-${ep.path}`}>
                                            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors group">
                                                <MethodBadge method={ep.method} />
                                                <code className="font-mono text-xs">{ep.path}</code>
                                                <span className="ml-auto text-xs text-muted-foreground">{ep.title}</span>
                                                <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="border-x border-b rounded-b-md px-3 py-3 space-y-3">
                                                <p className="text-sm text-muted-foreground">{ep.desc}</p>

                                                {ep.params && (
                                                    <div className="space-y-1">
                                                        <p className="text-xs font-semibold text-muted-foreground">쿼리 파라미터</p>
                                                        <div className="rounded-md border text-xs">
                                                            <table className="w-full">
                                                                <tbody>
                                                                    {ep.params.map((p) => (
                                                                        <tr key={p.name} className="border-b last:border-0">
                                                                            <td className="px-2 py-1.5 font-mono font-medium whitespace-nowrap">
                                                                                {p.name}
                                                                                {p.required && <span className="text-red-500 ml-0.5">*</span>}
                                                                            </td>
                                                                            <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{p.type}</td>
                                                                            <td className="px-2 py-1.5 text-muted-foreground">{p.desc}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                )}

                                                {ep.body && (
                                                    <div className="space-y-1">
                                                        <p className="text-xs font-semibold text-muted-foreground">요청 본문</p>
                                                        <CodeBlock>{ep.body}</CodeBlock>
                                                    </div>
                                                )}

                                                <div className="space-y-1">
                                                    <p className="text-xs font-semibold text-muted-foreground">응답</p>
                                                    <CodeBlock>{ep.response}</CodeBlock>
                                                </div>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 필터 연산자 */}
                <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold hover:text-foreground/80 group">
                        필터 연산자 <span className="text-xs font-normal text-muted-foreground">(레코드 API 전용)</span>
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2">
                        <p className="text-sm text-muted-foreground">
                            레코드 목록 조회 시 <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">filters</code> 쿼리 파라미터에 JSON 배열로 전달합니다.
                        </p>
                        <CodeBlock>{`?filters=[{"field":"이름","operator":"contains","value":"홍"}]`}</CodeBlock>
                        <div className="rounded-md border text-xs">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="px-2 py-1.5 text-left font-medium">연산자</th>
                                        <th className="px-2 py-1.5 text-left font-medium">설명</th>
                                        <th className="px-2 py-1.5 text-left font-medium">value 예시</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {FILTER_OPERATORS.map((f) => (
                                        <tr key={f.op} className="border-b last:border-0">
                                            <td className="px-2 py-1.5 font-mono">{f.op}</td>
                                            <td className="px-2 py-1.5 text-muted-foreground">{f.desc}</td>
                                            <td className="px-2 py-1.5 font-mono text-muted-foreground">{f.example}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </CardContent>
        </Card>
    );
}
