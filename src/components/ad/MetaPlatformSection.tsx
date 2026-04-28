"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import { useAdPlatforms } from "@/hooks/useAdPlatforms";
import { useAdAccounts } from "@/hooks/useAdAccounts";
import { useAdLeadIntegrations } from "@/hooks/useAdLeadIntegrations";
import { useAdLeadLogs } from "@/hooks/useAdLeadLogs";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import CreateIntegrationDialog from "@/components/ad/CreateIntegrationDialog";
import {
    RefreshCw,
    Unlink,
    Plus,
    Loader2,
    ChevronDown,
    ChevronRight,
    Facebook,
    Pencil,
} from "lucide-react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdPlatformInfo, AdLeadIntegrationInfo } from "@/types";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
    connected: { label: "연결됨", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    expired: { label: "만료됨", className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
    error: { label: "오류", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

const LOG_STATUS: Record<string, { label: string; className: string }> = {
    success: { label: "성공", className: "bg-green-100 text-green-700" },
    failed: { label: "실패", className: "bg-red-100 text-red-700" },
    duplicate: { label: "중복", className: "bg-yellow-100 text-yellow-700" },
    skipped: { label: "스킵", className: "bg-gray-100 text-gray-700" },
};

function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "-";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
}

function formatDateTime(dateStr: string): string {
    const d = new Date(dateStr);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MetaPlatformSection() {
    const { platforms, isLoading, mutate: mutatePlatforms, createPlatform, deletePlatform, syncAccounts } = useAdPlatforms();

    const metaPlatform = platforms.find((p) => p.platform === "meta");

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    로딩 중...
                </CardContent>
            </Card>
        );
    }

    return metaPlatform ? (
        <MetaConnected platform={metaPlatform} onMutate={mutatePlatforms} onDisconnect={deletePlatform} onSync={syncAccounts} />
    ) : (
        <MetaConnectForm onMutate={mutatePlatforms} onCreate={createPlatform} />
    );
}

// ─── 연결 안됨: App ID/Secret 입력 폼 ───

function MetaConnectForm({
    onMutate,
    onCreate,
}: {
    onMutate: () => void;
    onCreate: (params: { platform: "meta"; name: string; credentials: { type: "meta"; accessToken: string; appId: string; appSecret: string; pageAccessTokens: Record<string, string>; webhookVerifyToken: string } }) => Promise<{ success: boolean; error?: string; data?: { id: number } }>;
}) {
    const [appId, setAppId] = useState("");
    const [appSecret, setAppSecret] = useState("");
    const [saving, setSaving] = useState(false);

    const handleConnect = async () => {
        if (!appId.trim() || !appSecret.trim()) {
            toast.error("App ID와 App Secret을 모두 입력해주세요.");
            return;
        }

        setSaving(true);
        try {
            // Webhook verify token 자동 생성
            const verifyToken = `sendb_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

            // 1. 먼저 DB에 플랫폼 저장 (accessToken은 OAuth 후에 채워짐)
            const result = await onCreate({
                platform: "meta",
                name: "Meta 연결",
                credentials: {
                    type: "meta",
                    accessToken: "", // OAuth 후 채워짐
                    appId: appId.trim(),
                    appSecret: appSecret.trim(),
                    pageAccessTokens: {},
                    webhookVerifyToken: verifyToken,
                },
            });

            if (!result.success) {
                toast.error(result.error || "플랫폼 저장에 실패했습니다.");
                return;
            }

            // 2. OAuth 시작
            const res = await fetch(`/api/meta/auth-url?platformId=${result.data?.id || ""}`);
            const authResult = await res.json();
            if (authResult.success) {
                window.open(authResult.data.authUrl, "meta-oauth", "width=600,height=700");
                toast.success("Meta 로그인 창이 열렸습니다. 권한을 승인해주세요.");
            } else {
                toast.error(authResult.error || "OAuth URL 생성에 실패했습니다.");
            }
        } catch {
            toast.error("연결 중 오류가 발생했습니다.");
        } finally {
            setSaving(false);
        }
    };

    // OAuth 콜백 수신
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data?.type === "meta-oauth-callback") {
                if (event.data.status === "success") {
                    toast.success(event.data.message);
                    onMutate();
                } else {
                    toast.error(event.data.message);
                }
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onMutate]);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                        <Facebook className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <CardTitle>Meta (Facebook/Instagram)</CardTitle>
                        <CardDescription>Meta 광고에서 발생하는 리드를 자동으로 수집합니다.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-4 max-w-md">
                    <p className="text-sm text-muted-foreground">
                        Meta Developer 앱의 App ID와 App Secret을 입력하고 연결하세요.
                        <br />
                        <a
                            href="https://developers.facebook.com/apps"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            Meta Developer 콘솔에서 앱 만들기
                        </a>
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="meta-app-id">App ID</Label>
                        <Input
                            id="meta-app-id"
                            placeholder="Meta App ID를 입력하세요"
                            value={appId}
                            onChange={(e) => setAppId(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="meta-app-secret">App Secret</Label>
                        <Input
                            id="meta-app-secret"
                            type="password"
                            placeholder="Meta App Secret을 입력하세요"
                            value={appSecret}
                            onChange={(e) => setAppSecret(e.target.value)}
                        />
                    </div>
                    <Button onClick={handleConnect} disabled={saving || !appId.trim() || !appSecret.trim()}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Facebook className="h-4 w-4 mr-2" />}
                        Meta 연결하기
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

// ─── 연결됨: 계정 + 연동 + 로그 통합 뷰 ───

function MetaConnected({
    platform,
    onMutate,
    onDisconnect,
    onSync,
}: {
    platform: AdPlatformInfo;
    onMutate: () => void;
    onDisconnect: (id: number) => Promise<{ success: boolean }>;
    onSync: (id: number) => Promise<{ success: boolean; error?: string }>;
}) {
    const { accounts, mutate: mutateAccounts } = useAdAccounts(platform.id);
    const { integrations, mutate: mutateIntegrations, updateIntegration, deleteIntegration } = useAdLeadIntegrations();
    const { logs } = useAdLeadLogs();
    const { data: workspacesData } = useSWR<{ success: boolean; data: Array<{ id: number; name: string }> }>("/api/workspaces", defaultFetcher);
    const workspaces = workspacesData?.data || [];

    const [dialogOpen, setDialogOpen] = useState(false);
    const [detailIntegration, setDetailIntegration] = useState<typeof metaIntegrations[number] | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [accountsOpen, setAccountsOpen] = useState(true);
    const [integrationsOpen, setIntegrationsOpen] = useState(true);
    const [logsOpen, setLogsOpen] = useState(false);

    // 이 플랫폼의 연동만 필터
    const metaIntegrations = integrations.filter((i) => i.platform === "meta");
    const metaLogs = logs.filter((l) => metaIntegrations.some((i) => i.id === l.integrationId)).slice(0, 20);

    const handleSync = async () => {
        setSyncing(true);
        const result = await onSync(platform.id);
        if (result.success) {
            toast.success("광고 계정 동기화 완료");
            mutateAccounts();
        } else {
            toast.error(result.error || "동기화 실패");
        }
        setSyncing(false);
    };

    const handleDisconnect = () => {
        setConfirmAction({
            title: "Meta 연결 해제",
            description: "연결된 모든 광고 계정과 리드 연동 설정이 함께 삭제됩니다. 계속하시겠습니까?",
            onConfirm: async () => {
                const result = await onDisconnect(platform.id);
                if (result.success) {
                    toast.success("Meta 연결이 해제되었습니다.");
                    onMutate();
                }
                setConfirmAction(null);
            },
        });
    };

    const handleWorkspaceChange = async (accountId: number, workspaceId: string) => {
        const res = await fetch(`/api/ad-accounts/${accountId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId: workspaceId === "none" ? null : Number(workspaceId) }),
        });
        const result = await res.json();
        if (result.success) {
            mutateAccounts();
        } else {
            toast.error(result.error || "워크스페이스 연결 실패");
        }
    };

    const handleToggleIntegration = async (id: number, currentActive: number) => {
        const result = await updateIntegration(id, { isActive: currentActive === 1 ? 0 : 1 });
        if (!result.success) {
            toast.error(result.error || "상태 변경 실패");
        }
    };

    const handleDeleteIntegration = (id: number, name: string) => {
        setConfirmAction({
            title: "리드 연동 삭제",
            description: `"${name}" 연동을 삭제하시겠습니까?`,
            onConfirm: async () => {
                const result = await deleteIntegration(id);
                if (result.success) {
                    toast.success("연동이 삭제되었습니다.");
                } else {
                    toast.error(result.error || "삭제 실패");
                }
                setConfirmAction(null);
            },
        });
    };

    const statusBadge = STATUS_BADGE[platform.status] || STATUS_BADGE.connected;
    const credentials = platform.credentials as { webhookVerifyToken?: string; appId?: string };
    const webhookVerifyToken = credentials.webhookVerifyToken;
    const [showWebhookInfo, setShowWebhookInfo] = useState(false);

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                            <Facebook className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <CardTitle className="text-lg">Meta (Facebook/Instagram)</CardTitle>
                                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
                                    {statusBadge.label}
                                </span>
                            </div>
                            <CardDescription>
                                마지막 동기화: {formatRelativeTime(platform.lastSyncAt)}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                            계정 동기화
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleDisconnect} className="text-destructive hover:text-destructive">
                            <Unlink className="h-4 w-4 mr-1" />
                            연결 해제
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* ─── Webhook 설정 안내 ─── */}
                {webhookVerifyToken && (
                    <div className="border rounded-lg">
                        <div
                            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50"
                            onClick={() => setShowWebhookInfo(!showWebhookInfo)}
                        >
                            <div className="flex items-start gap-2 min-w-0">
                                {showWebhookInfo ? <ChevronDown className="h-4 w-4 shrink-0 mt-0.5" /> : <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" />}
                                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2 min-w-0">
                                    <span className="font-medium text-sm shrink-0">Webhook 설정</span>
                                    <span className="text-xs text-muted-foreground">리드 자동 수집을 위해 Meta Developer에서 설정 필요</span>
                                </div>
                            </div>
                        </div>
                        {showWebhookInfo && (
                            <div className="px-4 pb-4 space-y-3 text-sm">
                                <p className="text-muted-foreground">
                                    Meta Developer 앱 &gt; Webhooks &gt; Page 에서 아래 정보를 등록하세요.
                                </p>
                                <div className="space-y-2 bg-muted/50 rounded-lg p-3 font-mono text-xs">
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">콜백 URL:</span>
                                        <button
                                            className="text-blue-600 hover:underline"
                                            onClick={() => { navigator.clipboard.writeText("https://sendb.kr/api/webhooks/meta"); toast.success("복사됨"); }}
                                        >
                                            https://sendb.kr/api/webhooks/meta
                                        </button>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">인증 토큰:</span>
                                        <button
                                            className="text-blue-600 hover:underline"
                                            onClick={() => { navigator.clipboard.writeText(webhookVerifyToken); toast.success("복사됨"); }}
                                        >
                                            {webhookVerifyToken}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-muted-foreground">
                                    등록 후 <strong>leadgen</strong> 필드를 구독하세요.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* ─── 광고 계정 ─── */}
                <CollapsibleSection
                    title="광고 계정"
                    count={accounts.length}
                    open={accountsOpen}
                    onToggle={() => setAccountsOpen(!accountsOpen)}
                >
                    {accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-3">
                            광고 계정이 없습니다. 위의 &quot;계정 동기화&quot; 버튼을 클릭하세요.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>계정명</TableHead>
                                    <TableHead>계정 ID</TableHead>
                                    <TableHead>워크스페이스</TableHead>
                                    <TableHead>상태</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {accounts.map((account) => (
                                    <TableRow key={account.id}>
                                        <TableCell className="font-medium">{account.name}</TableCell>
                                        <TableCell className="text-muted-foreground text-xs">{account.externalAccountId}</TableCell>
                                        <TableCell>
                                            <Select
                                                value={account.workspaceId ? String(account.workspaceId) : "none"}
                                                onValueChange={(v) => handleWorkspaceChange(account.id, v)}
                                            >
                                                <SelectTrigger className="w-40 h-8">
                                                    <SelectValue placeholder="선택" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">미지정</SelectItem>
                                                    {workspaces.map((ws) => (
                                                        <SelectItem key={ws.id} value={String(ws.id)}>{ws.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                                account.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                                            }`}>
                                                {account.status === "active" ? "활성" : account.status}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CollapsibleSection>

                {/* ─── 리드 연동 ─── */}
                <CollapsibleSection
                    title="리드 연동"
                    count={metaIntegrations.length}
                    open={integrationsOpen}
                    onToggle={() => setIntegrationsOpen(!integrationsOpen)}
                    action={
                        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-1" />
                            연동 추가
                        </Button>
                    }
                >
                    {metaIntegrations.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-3">
                            등록된 리드 연동이 없습니다. 연동을 추가하여 리드를 자동 수집하세요.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>이름</TableHead>
                                    <TableHead>리드 폼</TableHead>
                                    <TableHead>대상 파티션</TableHead>
                                    <TableHead className="w-20">활성</TableHead>
                                    <TableHead className="w-10"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metaIntegrations.map((integration) => (
                                    <TableRow key={integration.id}>
                                        <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => setDetailIntegration(integration)}>{integration.name}</TableCell>
                                        <TableCell className="text-muted-foreground">{integration.formName || integration.formId}</TableCell>
                                        <TableCell>{integration.partitionName || "-"}</TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={integration.isActive === 1}
                                                onCheckedChange={() => handleToggleIntegration(integration.id, integration.isActive)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive hover:text-destructive h-8 w-8 p-0"
                                                onClick={() => handleDeleteIntegration(integration.id, integration.name)}
                                            >
                                                <Unlink className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CollapsibleSection>

                {/* ─── 수집 로그 ─── */}
                <CollapsibleSection
                    title="최근 수집 로그"
                    count={metaLogs.length}
                    open={logsOpen}
                    onToggle={() => setLogsOpen(!logsOpen)}
                >
                    {metaLogs.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-3">수집 로그가 없습니다.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>시간</TableHead>
                                    <TableHead>연동</TableHead>
                                    <TableHead>리드 ID</TableHead>
                                    <TableHead>상태</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metaLogs.map((log) => {
                                    const status = LOG_STATUS[log.status] || LOG_STATUS.skipped;
                                    return (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-muted-foreground text-xs">{formatDateTime(log.createdAt)}</TableCell>
                                            <TableCell>{log.integrationName || "-"}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{log.externalLeadId || "-"}</TableCell>
                                            <TableCell>
                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                                                    {status.label}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CollapsibleSection>

                <CreateIntegrationDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    onCreated={() => mutateIntegrations()}
                />

                <AlertDialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle>
                            <AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={confirmAction?.onConfirm}>확인</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* 연동 상세/수정 다이얼로그 */}
                {detailIntegration && (
                    <IntegrationDetailDialog
                        integration={detailIntegration}
                        open={!!detailIntegration}
                        onOpenChange={(open) => { if (!open) setDetailIntegration(null); }}
                        onUpdate={updateIntegration}
                        onUpdated={() => mutateIntegrations()}
                    />
                )}
            </CardContent>
        </Card>
    );
}

// ─── 접기/펼치기 섹션 ───

function CollapsibleSection({
    title,
    count,
    open,
    onToggle,
    action,
    children,
}: {
    title: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="border rounded-lg">
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium text-sm">{title}</span>
                    <span className="text-xs text-muted-foreground">({count})</span>
                </div>
                {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
            </div>
            {open && <div className="px-4 pb-3">{children}</div>}
        </div>
    );
}

// ─── 연동 상세/수정 다이얼로그 ───

function IntegrationDetailDialog({
    integration,
    open,
    onOpenChange,
    onUpdate,
    onUpdated,
}: {
    integration: AdLeadIntegrationInfo;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdate: (id: number, params: { fieldMappings?: Record<string, string>; defaultValues?: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>;
    onUpdated: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [mappings, setMappings] = useState<Array<{ from: string; to: string }>>([]);
    const [defaults, setDefaults] = useState<Array<{ key: string; value: string }>>([]);

    const startEditing = () => {
        setMappings(
            Object.entries(integration.fieldMappings || {}).map(([from, to]) => ({ from, to: String(to) }))
        );
        setDefaults(
            Object.entries(integration.defaultValues || {}).map(([key, val]) => ({ key, value: String(val) }))
        );
        setEditing(true);
    };

    const handleSave = async () => {
        setSaving(true);
        const fieldMappings: Record<string, string> = {};
        for (const m of mappings) {
            if (m.from.trim() && m.to.trim()) fieldMappings[m.from.trim()] = m.to.trim();
        }
        const defaultValues: Record<string, unknown> = {};
        for (const d of defaults) {
            if (d.key.trim() && d.value.trim()) defaultValues[d.key.trim()] = d.value.trim();
        }
        const result = await onUpdate(integration.id, { fieldMappings, defaultValues });
        if (result.success) {
            toast.success("연동 설정이 수정되었습니다.");
            setEditing(false);
            onUpdated();
            onOpenChange(false);
        } else {
            toast.error(result.error || "수정 실패");
        }
        setSaving(false);
    };

    const updateMapping = (index: number, field: "from" | "to", value: string) => {
        setMappings((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
    };

    const removeMapping = (index: number) => {
        setMappings((prev) => prev.filter((_, i) => i !== index));
    };

    const updateDefault = (index: number, field: "key" | "value", value: string) => {
        setDefaults((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
    };

    const removeDefault = (index: number) => {
        setDefaults((prev) => prev.filter((_, i) => i !== index));
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) { setEditing(false); } onOpenChange(o); }}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{integration.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <span className="text-muted-foreground">리드 폼</span>
                            <p className="font-medium">{integration.formName || integration.formId}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">대상 파티션</span>
                            <p className="font-medium">{integration.partitionName || "-"}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">상태</span>
                            <p className="font-medium">{integration.isActive === 1 ? "활성" : "비활성"}</p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">폼 ID</span>
                            <p className="font-mono text-xs">{integration.formId}</p>
                        </div>
                    </div>

                    {!editing ? (
                        <>
                            <div>
                                <span className="text-muted-foreground">필드 매핑</span>
                                <div className="mt-1 rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="text-xs">Meta 필드</TableHead>
                                                <TableHead className="text-xs">DB 컬럼</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {Object.entries(integration.fieldMappings || {}).map(([from, to]) => (
                                                <TableRow key={from}>
                                                    <TableCell className="font-mono text-xs py-1.5">{from}</TableCell>
                                                    <TableCell className="font-mono text-xs py-1.5">{to}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>

                            {integration.defaultValues && Object.keys(integration.defaultValues).length > 0 && (
                                <div>
                                    <span className="text-muted-foreground">기본값</span>
                                    <div className="mt-1 rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="text-xs">컬럼</TableHead>
                                                    <TableHead className="text-xs">값</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {Object.entries(integration.defaultValues).map(([key, val]) => (
                                                    <TableRow key={key}>
                                                        <TableCell className="font-mono text-xs py-1.5">{key}</TableCell>
                                                        <TableCell className="text-xs py-1.5">{String(val)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-end">
                                <Button size="sm" variant="outline" onClick={startEditing}>
                                    <Pencil className="h-4 w-4 mr-1" />
                                    수정
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-muted-foreground">필드 매핑</span>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMappings([...mappings, { from: "", to: "" }])}>
                                        <Plus className="h-3 w-3 mr-1" /> 추가
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {mappings.map((m, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input className="h-8 text-xs font-mono" placeholder="Meta 필드" value={m.from} onChange={(e) => updateMapping(i, "from", e.target.value)} />
                                            <span className="text-muted-foreground shrink-0">→</span>
                                            <Input className="h-8 text-xs font-mono" placeholder="DB 컬럼" value={m.to} onChange={(e) => updateMapping(i, "to", e.target.value)} />
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-destructive" onClick={() => removeMapping(i)}>
                                                <Unlink className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-muted-foreground">기본값</span>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDefaults([...defaults, { key: "", value: "" }])}>
                                        <Plus className="h-3 w-3 mr-1" /> 추가
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {defaults.map((d, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <Input className="h-8 text-xs font-mono" placeholder="컬럼" value={d.key} onChange={(e) => updateDefault(i, "key", e.target.value)} />
                                            <span className="text-muted-foreground shrink-0">=</span>
                                            <Input className="h-8 text-xs" placeholder="값" value={d.value} onChange={(e) => updateDefault(i, "value", e.target.value)} />
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-destructive" onClick={() => removeDefault(i)}>
                                                <Unlink className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>취소</Button>
                                <Button size="sm" onClick={handleSave} disabled={saving}>
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                    저장
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
