"use client";
import { useState } from "react";
import type { InboxBootstrap, Conversation } from "@/components/inbox/types";
export function TeamAssignment({
    bootstrap,
    chat,
    workspaceId,
    canRespond,
    change,
}: {
    bootstrap: InboxBootstrap;
    chat: Conversation;
    workspaceId: number;
    canRespond: boolean;
    change: (value: unknown) => Promise<unknown>;
}) {
    const teams = (bootstrap.teams ?? []).filter(
        (t) => t.channelId === chat.channelId,
    );
    const team = teams.find((t) => t.id === chat.teamId);
    const previousOwner =
        bootstrap.members.find((m) => m.id === chat.assigneeId)?.name ??
        team?.members.find((m) => m.id === chat.assigneeId)?.name ??
        bootstrap.mentionMembers?.find((m) => m.id === chat.assigneeId)?.name ??
        "기존 담당자";
    // 이 사업에서 상담권한이 켜진 직원 (상담 설정 › 상담 담당자)
    const members = bootstrap.members.filter((m) => m.workspaceIds.includes(workspaceId));
    const [pending, setPending] = useState(false);
    const disabled = !!chat.historyOnly || !canRespond || pending;
    async function assign(value: unknown) {
        setPending(true);
        try {
            await change(value);
        } finally {
            setPending(false);
        }
    }
    return (
        <section className="space-y-3">
            <h3 className="font-semibold">담당 정보</h3>
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                담당자
                <select
                    aria-label="담당자"
                    disabled={disabled}
                    value={chat.assigneeId ?? ""}
                    className="max-w-[160px] rounded-lg border bg-background px-2 py-1.5 text-foreground"
                    onChange={(e) =>
                        void assign({ assigneeId: e.target.value || null })
                    }
                >
                    <option value="">담당자 없음</option>
                    {chat.assigneeId &&
                        !members.some((m) => m.id === chat.assigneeId) && (
                            <option value={chat.assigneeId} disabled>
                                {previousOwner} · 상담권한 없음
                            </option>
                        )}
                    {members.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.name}
                        </option>
                    ))}
                </select>
            </label>
            {pending && (
                <p role="status" className="text-[10px] text-muted-foreground">
                    배정을 변경하고 있습니다…
                </p>
            )}
        </section>
    );
}
