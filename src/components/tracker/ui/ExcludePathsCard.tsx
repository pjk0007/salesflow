"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Filter } from "lucide-react";
import { toast } from "sonner";
import { updateTrackerSite } from "../api/trackerSites";

/**
 * 트래커 설정 탭 — 분석 제외 경로 prefix 관리.
 * 로그인 후 영역(/main/ 등)을 인기 페이지/세션 집계에서 제외하기 위함.
 * 한 줄에 prefix 하나씩 입력. 빈 줄은 무시.
 */
export function ExcludePathsCard({
    siteId,
    excludePaths,
    onUpdated,
}: {
    siteId: number;
    excludePaths: string[];
    onUpdated: () => void;
}) {
    const [text, setText] = useState(() => excludePaths.join("\n"));
    const [saving, setSaving] = useState(false);

    const original = excludePaths.join("\n");
    const dirty = text.trim() !== original.trim();

    const handleSave = async () => {
        const next = text
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        setSaving(true);
        try {
            await updateTrackerSite(siteId, { excludePaths: next });
            toast.success("제외 경로가 저장되었습니다.");
            onUpdated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "저장 실패");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    분석 제외 경로
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    로그인 후 영역 등 분석에서 빼고 싶은 경로 prefix를 한 줄에 하나씩 적으세요.
                    예: <code className="rounded bg-muted px-1">/main/</code>, <code className="rounded bg-muted px-1">/login/</code>
                </p>
                <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="/main/&#10;/login/"
                    rows={5}
                    className="font-mono text-xs"
                />
                <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                    {saving ? "저장 중..." : "저장"}
                </Button>
            </CardContent>
        </Card>
    );
}
