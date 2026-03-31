"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useAdPlatforms } from "@/hooks/useAdPlatforms";
import { RefreshCw, Unlink, Loader2, Plus } from "lucide-react";
import { useEffect, useCallback } from "react";
import type { AdPlatformType, AdPlatformStatus } from "@/types";

const PLATFORM_LABELS: Record<AdPlatformType, string> = {
    meta: "Meta (Facebook/Instagram)",
    google: "Google Ads",
    naver: "Naver 검색광고",
};

const STATUS_CONFIG: Record<AdPlatformStatus, { label: string; variant: string }> = {
    connected: { label: "연결됨", variant: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    expired: { label: "만료됨", variant: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
    error: { label: "오류", variant: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    disconnected: { label: "연결 해제", variant: "bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300" },
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
    if (days < 30) return `${days}일 전`;
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function AdPlatformList() {
    const { platforms, isLoading, mutate, deletePlatform, syncAccounts } = useAdPlatforms();

    // Meta OAuth 팝업 결과 수신
    const handleOAuthMessage = useCallback((event: MessageEvent) => {
        if (event.data?.type === "meta-oauth-callback") {
            if (event.data.status === "success") {
                toast.success(event.data.message);
                mutate();
            } else {
                toast.error(event.data.message);
            }
        }
    }, [mutate]);

    useEffect(() => {
        window.addEventListener("message", handleOAuthMessage);
        return () => window.removeEventListener("message", handleOAuthMessage);
    }, [handleOAuthMessage]);

    const handleConnectMeta = async () => {
        try {
            const res = await fetch("/api/meta/auth-url");
            const result = await res.json();
            if (result.success) {
                window.open(result.data.authUrl, "meta-oauth", "width=600,height=700");
            } else {
                toast.error(result.error || "OAuth URL 생성에 실패했습니다.");
            }
        } catch {
            toast.error("Meta 연결 중 오류가 발생했습니다.");
        }
    };

    const handleSync = async (id: number) => {
        const result = await syncAccounts(id);
        if (result.success) {
            toast.success("계정 동기화가 완료되었습니다.");
        } else {
            toast.error(result.error || "동기화에 실패했습니다.");
        }
    };

    const handleDisconnect = async (id: number, name: string) => {
        if (!window.confirm(`"${name}" 플랫폼 연결을 해제하시겠습니까? 연결된 광고 계정과 연동 설정도 함께 삭제됩니다.`)) {
            return;
        }
        const result = await deletePlatform(id);
        if (result.success) {
            toast.success("플랫폼 연결이 해제되었습니다.");
        } else {
            toast.error(result.error || "연결 해제에 실패했습니다.");
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>플랫폼 연결</CardTitle>
                    <CardDescription>
                        광고 플랫폼을 연결하여 리드를 자동으로 수집합니다.
                    </CardDescription>
                </div>
                <Button onClick={handleConnectMeta} size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Meta 연결
                </Button>
            </CardHeader>
            <CardContent>
                {platforms.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        연결된 광고 플랫폼이 없습니다.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {platforms.map((platform) => {
                            const statusConfig = STATUS_CONFIG[platform.status];
                            return (
                                <div
                                    key={platform.id}
                                    className="flex items-center justify-between rounded-lg border p-4"
                                >
                                    <div className="flex items-center gap-4">
                                        <div>
                                            <div className="font-medium">
                                                {PLATFORM_LABELS[platform.platform]}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                마지막 동기화: {formatRelativeTime(platform.lastSyncAt)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span
                                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.variant}`}
                                        >
                                            {statusConfig.label}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleSync(platform.id)}
                                        >
                                            <RefreshCw className="h-4 w-4 mr-1" />
                                            계정 동기화
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleDisconnect(platform.id, PLATFORM_LABELS[platform.platform])}
                                            className="text-destructive hover:text-destructive"
                                        >
                                            <Unlink className="h-4 w-4 mr-1" />
                                            연결 해제
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
