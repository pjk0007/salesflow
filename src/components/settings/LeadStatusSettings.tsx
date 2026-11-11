"use client";

import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLeadStatuses } from "@/components/leads/hooks/useLeadStatuses";
import { StatusBadge } from "@/components/leads/ui/StatusBadge";
import { LEAD_STATUS_COLORS } from "@/lib/leads/statuses";

/** 워크스페이스 설정 — 리드 관리 대응상태 켜고 끄기 (순서는 기본 순서 고정) */
export function LeadStatusSettings({ workspaceId }: { workspaceId: number }) {
    const { settings, mutate } = useLeadStatuses(workspaceId);

    const toggle = async (label: string, enabled: boolean) => {
        const next = settings.map((s) => (s.label === label ? { ...s, enabled } : s));
        mutate({ success: true, data: next }, { revalidate: false });
        const res = await fetch(`/api/workspaces/${workspaceId}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadStatuses: next }),
        });
        const result = await res.json();
        if (!result.success) toast.error(result.error || "저장에 실패했습니다.");
        mutate();
    };

    return (
        <div className="space-y-2">
            <Label>리드 대응상태</Label>
            <p className="text-xs text-muted-foreground">
                리드 관리 화면에 보일 상태를 고릅니다. 끈 상태의 리드는 &apos;기타 상태&apos; 묶음에 보입니다.
            </p>
            <div className="divide-y rounded-md border">
                {settings.map((s) => (
                    <div key={s.label} className="flex items-center justify-between px-3 py-2">
                        <StatusBadge status={s.label} colors={LEAD_STATUS_COLORS} active={s.enabled} />
                        <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s.label, v)} aria-label={`${s.label} 사용`} />
                    </div>
                ))}
            </div>
        </div>
    );
}
