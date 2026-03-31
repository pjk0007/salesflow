"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAdAccounts } from "@/hooks/useAdAccounts";
import { useAdPlatforms } from "@/hooks/useAdPlatforms";
import type { AdPlatformType, AdAccountStatus } from "@/types";

const PLATFORM_LABELS: Record<AdPlatformType, string> = {
    meta: "Meta",
    google: "Google",
    naver: "Naver",
};

const ACCOUNT_STATUS_CONFIG: Record<AdAccountStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "활성", variant: "default" },
    paused: { label: "일시중지", variant: "secondary" },
    disabled: { label: "비활성", variant: "destructive" },
};

interface Workspace {
    id: number;
    name: string;
}

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

export default function AdAccountList() {
    const { accounts, isLoading, updateAccount } = useAdAccounts();
    const { platforms } = useAdPlatforms();
    const platformMap = new Map(platforms.map((p) => [p.id, p.platform]));
    const { data: wsData } = useSWR<{ success: boolean; data: Workspace[] }>(
        "/api/workspaces",
        defaultFetcher
    );
    const workspaces = wsData?.data || [];

    const handleWorkspaceChange = async (accountId: number, value: string) => {
        const workspaceId = value === "none" ? null : Number(value);
        const result = await updateAccount(accountId, { workspaceId });
        if (result.success) {
            toast.success("워크스페이스가 변경되었습니다.");
        } else {
            toast.error(result.error || "변경에 실패했습니다.");
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>광고 계정</CardTitle>
                <CardDescription>
                    광고 계정을 워크스페이스에 연결하여 사업 단위를 구분합니다.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {accounts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        연결된 광고 계정이 없습니다.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>계정명</TableHead>
                                <TableHead>플랫폼</TableHead>
                                <TableHead>워크스페이스</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead>마지막 동기화</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {accounts.map((account) => {
                                const statusConfig = ACCOUNT_STATUS_CONFIG[account.status];
                                return (
                                    <TableRow key={account.id}>
                                        <TableCell className="font-medium">
                                            {account.name}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {PLATFORM_LABELS[platformMap.get(account.adPlatformId) || "meta"]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={account.workspaceId ? String(account.workspaceId) : "none"}
                                                onValueChange={(value) => handleWorkspaceChange(account.id, value)}
                                            >
                                                <SelectTrigger className="w-45">
                                                    <SelectValue placeholder="워크스페이스 선택" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">미지정</SelectItem>
                                                    {workspaces.map((ws) => (
                                                        <SelectItem key={ws.id} value={String(ws.id)}>
                                                            {ws.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={statusConfig.variant}>
                                                {statusConfig.label}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatRelativeTime(account.lastSyncAt)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
