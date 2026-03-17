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
import { Plus, MoreHorizontal, Pencil, Trash2, Copy, Check, ChevronDown } from "lucide-react";
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

const ENDPOINTS = [
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
        title: "레코드 생성",
        desc: "새 레코드를 생성합니다. 자동 배분·자동 발송 트리거가 실행됩니다.",
        params: null,
        body: `{
  "partitionId": 1,
  "data": {
    "이름": "홍길동",
    "이메일": "hong@example.com",
    "전화번호": "010-1234-5678"
  }
}`,
        response: `{
  "success": true,
  "data": { "id": 42, "data": { ... }, ... }
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
        title: "레코드 수정",
        desc: "레코드 데이터를 부분 업데이트합니다. 기존 데이터와 병합됩니다.",
        params: null,
        body: `{
  "data": {
    "상태": "계약완료",
    "메모": "3월 계약 체결"
  }
}`,
        response: `{
  "success": true,
  "data": { "id": 42, "data": { ... }, ... }
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

function ApiDocsCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle>API 문서</CardTitle>
                <CardDescription>
                    외부 시스템에서 Sendb 레코드에 접근하기 위한 REST API 레퍼런스입니다.
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

                {/* 엔드포인트 */}
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold">엔드포인트</h4>
                    <div className="space-y-2">
                        {ENDPOINTS.map((ep) => (
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

                {/* 필터 연산자 */}
                <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold hover:text-foreground/80 group">
                        필터 연산자
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 space-y-2">
                        <p className="text-sm text-muted-foreground">
                            <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">filters</code> 쿼리 파라미터에 JSON 배열로 전달합니다.
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
