"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { workspaceLabel } from "@/lib/workspace-label";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import type { InboxBootstrap } from "../types";

/**
 * 상담톡·상담통계·상담 설정 맨 윗줄 사업부 탭. 다른 화면과 같은 탭을 쓰고, 기본은 상담창이 있는 사업만 보인다.
 * 끌어서 순서 바꾸기·오른쪽 클릭으로 숨기기·"사업부 추가"는 사람마다 저장되고 세 화면이 같이 쓴다.
 * 탭 값은 사업(워크스페이스) id, 고르면 그 사업의 첫 상담창으로 바꾼다.
 */
export function InboxChannelTabs({
    bootstrap,
    channelId,
    onChange,
    right,
    onNewChannel,
}: {
    bootstrap: InboxBootstrap | undefined;
    channelId: number | null;
    onChange: (channelId: number) => void;
    right?: React.ReactNode;
    /** 상담창 없는 사업부를 꺼내 "만들기"를 고르면 (없으면 상담 설정의 새 상담창으로 이동) */
    onNewChannel?: (workspaceId: number) => void;
}) {
    const router = useRouter();
    const [asking, setAsking] = useState<{ id: number; name: string } | null>(null);
    const { workspaces } = useWorkspaces();
    const channels = bootstrap?.channels ?? [];
    const label = (id: number, fallback: string) => {
        const ws = workspaces.find((w) => w.id === id);
        return { name: ws?.name ?? bootstrap?.workspaces.find((w) => w.id === id)?.name ?? fallback, displayNo: ws?.displayNo ?? null };
    };
    const items = channels
        .filter((c, i) => channels.findIndex((x) => x.workspaceId === c.workspaceId) === i)
        .map((c) => ({ id: c.workspaceId, ...label(c.workspaceId, c.name) }));
    const pool = (bootstrap?.workspaces ?? []).map((w) => ({ id: w.id, ...label(w.id, w.name) }));
    const current = channels.find((c) => c.id === channelId);
    return (
        <>
        <AlertDialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{asking?.name}에는 아직 상담창이 없어요</AlertDialogTitle>
                    <AlertDialogDescription>상담창을 만들까요? 확인을 누르면 사이트 상담창 설정 화면으로 이동해요.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            if (!asking) return;
                            if (onNewChannel) onNewChannel(asking.id);
                            else router.push(`/inbox/settings?new=1&workspaceId=${asking.id}`);
                            setAsking(null);
                        }}
                    >
                        확인
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        <LeadWorkspaceTabs
            value={current?.workspaceId ?? null}
            items={items}
            pool={pool}
            prefKey="inbox"
            loading={!bootstrap}
            right={right}
            // 상담창이 없는 사업부를 꺼내면 만들지 묻는다
            onCreate={async (workspaceId) => {
                const ws = bootstrap?.workspaces.find((w) => w.id === workspaceId);
                if (ws?.abilities.manage) setAsking({ id: workspaceId, name: workspaceLabel(pool.find((p) => p.id === workspaceId) ?? ws) });
                else toast.error("이 사업부는 아직 상담창이 없어요. 관리자에게 상담창 만들기를 요청해주세요.");
                return false;
            }}
            onChange={(workspaceId) => {
                const next = channels.find((c) => c.workspaceId === workspaceId);
                if (next) onChange(next.id);
            }}
        />
        </>
    );
}
