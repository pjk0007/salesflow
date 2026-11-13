"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
import type { InboxBootstrap } from "@/components/inbox/types";
import { InboxChannelTabs } from "@/components/inbox/ui/InboxChannelTabs";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { OperationsView } from "./OperationsView";

/** 상담통계 — 사업부 탭 + 응대 성과·업무시간 설정 (예전 상담톡 "운영·성과" 창) */
export function InboxStatsPage() {
    const router = useRouter();
    const bootstrap = useSWR<InboxBootstrap>("/api/inbox", inboxRequest);
    const data = bootstrap.data;
    const [chosen, setChosen] = useState<number | null>(null);
    const channelId = chosen ?? data?.channels[0]?.id ?? null;
    const channel = data?.channels.find((c) => c.id === channelId);
    return (
        <div className="flex h-full min-h-[600px] flex-col bg-background">
            <header className="flex min-h-16 shrink-0 items-center border-b px-5 py-3">
                <h1 className="text-lg font-semibold">상담통계</h1>
            </header>
            {data && channel && (
                <InboxChannelTabs bootstrap={data} channelId={channelId} onChange={setChosen} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {bootstrap.error ? (
                    <p role="alert" className="text-sm text-red-700">{bootstrap.error.message}</p>
                ) : !data ? (
                    <p className="text-sm text-muted-foreground">불러오는 중…</p>
                ) : !channel ? (
                    <p className="text-sm text-muted-foreground">아직 상담창이 있는 사업이 없습니다.</p>
                ) : (
                    <OperationsView
                        key={channel.id}
                        channelId={channel.id}
                        canManage={workspaceAbilities(data, channel.workspaceId).manage}
                        onSelect={(row) => {
                            const q = new URLSearchParams({
                                channelId: String(row.channelId),
                                conversation: row.conversationId,
                                ...(row.messageId ? { message: String(row.messageId) } : {}),
                                ...(row.status ? { status: row.status } : {}),
                            });
                            router.push(`/inbox?${q}`);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
