"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OperationsSettingsEditor } from "@/components/inbox-operations/ui/OperationsSettingsEditor";
import { workspaceAbilities } from "@/components/customer-access/utils/abilities";
import { ResponderToggles } from "@/components/customer-access/ui/ResponderToggles";
import { EmailMailboxSettings } from "@/components/inbox-email/ui/EmailMailboxSettings";
import { useEmailMailboxes } from "@/components/inbox-email/hooks/useEmailMailboxes";
import { mailboxAlert } from "@/components/inbox-email/utils/mailbox-alert";
import { connectionResultMessage, connectionSucceeded } from "@/components/inbox-email/utils/connection-result";
import { inboxRequest } from "../api";
import type { InboxBootstrap } from "../types";
import { ChannelSettings } from "./ChannelSettings";
import { InboxChannelTabs } from "./InboxChannelTabs";
import { SettingsSection } from "./SettingsSection";
import { MacroSettings } from "@/components/inbox-macros/ui/MacroSettings";

type Menu = "site" | "hours" | "goals" | "macros" | "email" | "responders";
type Panel = Menu | "new";

/**
 * 상담 설정 — 맨 위 사업부 탭, 왼쪽 설정 메뉴, 오른쪽에 고른 설정을 넓게 펼친다.
 * ?open=email 또는 구글 메일 승인 결과(channelId+emailConnection)로 들어오면 이메일 연결을, ?new=1이면 새 상담창 만들기를 연다.
 */
export function InboxSettingsPage() {
    const params = useSearchParams(),
        router = useRouter(),
        pathname = usePathname();
    const bootstrap = useSWR<InboxBootstrap>("/api/inbox", inboxRequest);
    const data = bootstrap.data;
    const [chosen, setChosen] = useState<number | null>(Number(params.get("channelId")) || null);
    const channelId = chosen ?? data?.channels[0]?.id ?? null;
    const channel = data?.channels.find((c) => c.id === channelId);
    const abilities = workspaceAbilities(data, channel?.workspaceId);
    const canCreate = !!data?.workspaces.some((w) => w.abilities.manage);
    const [newWorkspaceId, setNewWorkspaceId] = useState<number | null>(Number(params.get("workspaceId")) || null);
    const [panel, setPanel] = useState<Panel>(() =>
        params.get("new") ? "new" : params.get("open") === "email" || (params.has("emailConnection") && params.has("channelId")) ? "email" : "site",
    );
    useEffect(() => {
        const result = params.get("emailConnection");
        if (!result || params.has("channelId")) return;
        (connectionSucceeded(result) ? toast.info : toast.error)(connectionResultMessage(result));
        const next = new URLSearchParams(params.toString());
        next.delete("emailConnection");
        router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }, [params, pathname, router]);
    const mailboxes = useEmailMailboxes(channel && abilities.manage ? channel.workspaceId : null);
    const { reconnectCount } = mailboxAlert(mailboxes.data);
    const refresh = () => bootstrap.mutate();

    const menus: { id: Menu; group: string; label: string; show: boolean; badge?: string }[] = [
        { id: "site", group: "상담창", label: "사이트 상담창", show: abilities.manage },
        { id: "hours", group: "상담창", label: "업무시간", show: !!channel },
        { id: "goals", group: "상담창", label: "응대 목표", show: !!channel },
        { id: "macros", group: "상담창", label: "매크로", show: !!channel },
        { id: "email", group: "상담창", label: "이메일 연결", show: abilities.manage, badge: reconnectCount > 0 ? "재연결" : undefined },
        { id: "responders", group: "담당", label: "상담 담당자", show: abilities.manage },
    ];
    const shown = menus.filter((m) => m.show);
    // 고른 메뉴를 이 사업에서 볼 수 없으면 첫 메뉴로
    const current: Panel | null = panel === "new" ? (canCreate ? "new" : null) : shown.some((m) => m.id === panel) ? panel : (shown[0]?.id ?? null);

    // 상담창이 하나도 없을 때만 쓰는 버튼 — 그 밖엔 사업부 탭의 "사업부 추가"에서 만든다
    const createButton = canCreate && (
        <Button variant="outline" className="border-border/70" onClick={() => setPanel("new")}>
            <Plus className="h-4 w-4" />
            상담창 만들기
        </Button>
    );

    function content() {
        if (current === "new" && data)
            return (
                <ChannelSettings
                    key={`new:${newWorkspaceId ?? ""}`}
                    bootstrap={data}
                    initialWorkspaceId={newWorkspaceId}
                    onSaved={async (c) => {
                        await refresh();
                        setChosen(c.id);
                        setPanel("site");
                    }}
                />
            );
        if (!channel) return null;
        switch (current) {
            case "site":
                return <ChannelSettings key={`site:${channel.id}`} bootstrap={data!} channel={channel} onSaved={() => void refresh()} />;
            case "hours":
                return (
                    <SettingsSection title="업무시간" description="업무시간·휴무일과 업무시간 밖 고객 안내를 정합니다.">
                        <OperationsSettingsEditor key={channel.id} channelId={channel.id} canManage={abilities.manage} section="hours" />
                    </SettingsSection>
                );
            case "goals":
                return (
                    <SettingsSection title="응대 목표" description="첫 답변·추가 답변·해결까지의 목표 시간을 정합니다. 상담통계에서 지켰는지 볼 수 있어요.">
                        <OperationsSettingsEditor key={channel.id} channelId={channel.id} canManage={abilities.manage} section="goals" />
                    </SettingsSection>
                );
            case "macros":
                return <MacroSettings key={channel.workspaceId} workspaceId={channel.workspaceId} canManage={abilities.manage} />;
            case "email":
                return <EmailMailboxSettings key={channel.workspaceId} workspaceId={channel.workspaceId} />;
            case "responders":
                return <ResponderToggles key={channel.workspaceId} workspaceId={channel.workspaceId} canManage={abilities.manage} onSaved={refresh} />;
            default:
                return null;
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {data && channel ? (
                <InboxChannelTabs
                    bootstrap={data}
                    channelId={channelId}
                    onChange={(id) => {
                        setChosen(id);
                        if (panel === "new") setPanel("site");
                    }}
                    onNewChannel={(id) => {
                        setNewWorkspaceId(id);
                        setPanel("new");
                    }}
                />
            ) : (
                <div className="flex h-12 shrink-0 items-center justify-end border-b px-4">{createButton}</div>
            )}
            {bootstrap.error ? (
                <p role="alert" className="p-8 text-sm text-red-700">{bootstrap.error.message}</p>
            ) : !data ? (
                <p className="p-8 text-sm text-muted-foreground">불러오는 중…</p>
            ) : !channel && current !== "new" ? (
                <p className="p-8 text-sm text-muted-foreground">
                    {canCreate ? "아직 상담창이 없습니다. 오른쪽 위 상담창 만들기를 눌러주세요." : "관리자에게 상담창 설정을 요청해주세요."}
                </p>
            ) : (
                // 왼쪽 좁은 메뉴(묶음 제목) + 오른쪽 흰 카드에 고른 설정. 처음엔 첫 메뉴가 열려 있다
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                    <div className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-8 p-8">
                        <nav aria-label="상담 설정 메뉴" className="sticky top-0 space-y-6">
                            {current === "new" && (
                                <div className="rounded-lg bg-muted px-4 py-2.5 text-sm font-medium">새 상담창 만들기</div>
                            )}
                            {[...new Set(shown.map((m) => m.group))].map((group) => (
                                <div key={group}>
                                    <p className="mb-2 px-4 text-xs font-medium text-muted-foreground">{group}</p>
                                    {shown
                                        .filter((m) => m.group === group)
                                        .map((m) => (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => setPanel(m.id)}
                                                className={cn(
                                                    "mb-0.5 flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm",
                                                    current === m.id ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60",
                                                )}
                                            >
                                                <span className="flex-1">{m.label}</span>
                                                {m.badge && <span className="text-[11px] font-medium text-amber-700">{m.badge}</span>}
                                            </button>
                                        ))}
                                </div>
                            ))}
                            {!shown.length && current !== "new" && (
                                <p className="px-4 text-xs text-muted-foreground">이 사업의 상담 설정을 바꿀 권한이 없습니다.</p>
                            )}
                        </nav>
                        <div className="min-w-0 rounded-lg border border-border/40 bg-background p-8">{content()}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
