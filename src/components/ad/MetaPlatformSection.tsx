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
import { toast } from "sonner";
import { useAdPlatforms } from "@/hooks/useAdPlatforms";
import { useAdAccounts } from "@/hooks/useAdAccounts";
import { useAdLeadIntegrations } from "@/hooks/useAdLeadIntegrations";
import { useAdLeadLogs } from "@/hooks/useAdLeadLogs";
import CreateIntegrationDialog from "@/components/ad/CreateIntegrationDialog";
import {
    RefreshCw,
    Unlink,
    Plus,
    Loader2,
    ChevronDown,
    ChevronRight,
    Facebook,
} from "lucide-react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdPlatformInfo } from "@/types";

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
    onCreate: (params: { platform: "meta"; name: string; credentials: { type: "meta"; accessToken: string; appId: string; appSecret: string; pageAccessTokens: Record<string, string> } }) => Promise<{ success: boolean; error?: string; data?: { id: number } }>;
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
    const { integrations, mutate: mutateIntegrations, updateIntegration } = useAdLeadIntegrations();
    const { logs } = useAdLeadLogs();
    const { data: workspacesData } = useSWR<{ success: boolean; data: Array<{ id: number; name: string }> }>("/api/workspaces", defaultFetcher);
    const workspaces = workspacesData?.data || [];

    const [dialogOpen, setDialogOpen] = useState(false);
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

    const handleDisconnect = async () => {
        if (!window.confirm("Meta 연결을 해제하시겠습니까?\n연결된 모든 광고 계정과 리드 연동 설정이 삭제됩니다.")) return;
        const result = await onDisconnect(platform.id);
        if (result.success) {
            toast.success("Meta 연결이 해제되었습니다.");
            onMutate();
        }
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

    const statusBadge = STATUS_BADGE[platform.status] || STATUS_BADGE.connected;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                            <Facebook className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <CardTitle className="text-lg">Meta (Facebook/Instagram)</CardTitle>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.className}`}>
                                    {statusBadge.label}
                                </span>
                            </div>
                            <CardDescription>
                                마지막 동기화: {formatRelativeTime(platform.lastSyncAt)}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {metaIntegrations.map((integration) => (
                                    <TableRow key={integration.id}>
                                        <TableCell className="font-medium">{integration.name}</TableCell>
                                        <TableCell className="text-muted-foreground">{integration.formName || integration.formId}</TableCell>
                                        <TableCell>{integration.partitionName || "-"}</TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={integration.isActive === 1}
                                                onCheckedChange={() => handleToggleIntegration(integration.id, integration.isActive)}
                                            />
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
