"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { MatchFieldSelect } from "./MatchFieldSelect";
import { updateTrackerSite } from "../api/trackerSites";

/**
 * 트래커 설정 탭 — 식별 매칭 필드 수정 카드.
 */
export function MatchFieldCard({
    siteId,
    workspaceId,
    matchField,
    onUpdated,
}: {
    siteId: number;
    workspaceId: number;
    matchField: string | null;
    onUpdated: () => void;
}) {
    const [value, setValue] = useState<string | null>(matchField);
    const [saving, setSaving] = useState(false);

    const dirty = (value ?? null) !== (matchField ?? null);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateTrackerSite(siteId, { matchField: value });
            toast.success("매칭 필드가 저장되었습니다.");
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
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    식별 매칭 필드
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <MatchFieldSelect
                    workspaceId={workspaceId}
                    value={value}
                    onChange={setValue}
                />
                <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
                    {saving ? "저장 중..." : "저장"}
                </Button>
            </CardContent>
        </Card>
    );
}
