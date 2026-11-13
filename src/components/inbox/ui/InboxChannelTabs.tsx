"use client";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import type { InboxBootstrap } from "../types";

/**
 * 상담톡·상담통계 맨 윗줄 사업부 탭. 다른 화면과 같은 탭을 쓰고, 상담창이 있는 사업만 보인다.
 * 탭 값은 사업(워크스페이스) id, 고르면 그 사업의 첫 상담창으로 바꾼다.
 */
export function InboxChannelTabs({
    bootstrap,
    channelId,
    onChange,
    right,
}: {
    bootstrap: InboxBootstrap | undefined;
    channelId: number | null;
    onChange: (channelId: number) => void;
    right?: React.ReactNode;
}) {
    const { workspaces } = useWorkspaces();
    const channels = bootstrap?.channels ?? [];
    const items = channels
        .filter((c, i) => channels.findIndex((x) => x.workspaceId === c.workspaceId) === i)
        .map((c) => {
            const ws = workspaces.find((w) => w.id === c.workspaceId);
            const name = ws?.name ?? bootstrap?.workspaces.find((w) => w.id === c.workspaceId)?.name ?? c.name;
            return { id: c.workspaceId, name, displayNo: ws?.displayNo ?? null };
        });
    const current = channels.find((c) => c.id === channelId);
    return (
        <LeadWorkspaceTabs
            value={current?.workspaceId ?? null}
            items={items}
            loading={!bootstrap}
            right={right}
            onChange={(workspaceId) => {
                const next = channels.find((c) => c.workspaceId === workspaceId);
                if (next) onChange(next.id);
            }}
        />
    );
}
