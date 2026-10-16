"use client";
import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import {
    useNotificationCount,
    useSupportNotifications,
} from "../hooks/useOperations";
import { readSupportNotifications } from "../api";
import { operationsLabels, operationTime } from "../utils/display";
import type { OpenSupportConversation } from "../types";
export function SupportAlertLink() {
    const { data } = useNotificationCount();
    return (
        <Link
            className="rounded-lg border px-3 py-1.5 text-xs"
            href="/inbox?notifications=open"
        >
            상담 알림 {data?.unread ?? 0}
        </Link>
    );
}
export function SupportNotifications({
    onSelect,
    initialOpen = false,
    channels,
}: {
    onSelect: OpenSupportConversation;
    initialOpen?: boolean;
    channels: { id: number; name: string }[];
}) {
    const [open, setOpen] = useState(initialOpen),
        [unread, setUnread] = useState(false),
        [busy, setBusy] = useState(false),
        pages = useSupportNotifications(unread),
        rows =
            pages.data
                ?.flatMap((p) => p.rows)
                .filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i) ??
            [],
        count = pages.data?.[0]?.unread ?? 0;
    async function read(ids: string[]) {
        if (!ids.length) return;
        setBusy(true);
        try {
            for (let i = 0; i < ids.length; i += 100)
                await readSupportNotifications(ids.slice(i, i + 100));
            await pages.mutate();
        } catch (e) {
            toast.error((e as Error).message);
            throw e;
        } finally {
            setBusy(false);
        }
    }
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-1 rounded-xl border px-3 py-2 text-xs"
                aria-label={`상담 알림 ${count}개`}
            >
                <Bell size={14} />
                알림 {count > 99 ? "99+" : count}
            </button>
            {open && (
                <div
                    className="fixed inset-0 z-50 flex justify-end bg-black/30"
                    onClick={() => setOpen(false)}
                >
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-label="내 상담 알림"
                        className="h-full w-full max-w-lg space-y-4 overflow-auto bg-background p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="flex items-center justify-between">
                            <h2 className="font-semibold">
                                내 상담 알림{" "}
                                <span className="text-muted-foreground">
                                    {count}개 미확인
                                </span>
                            </h2>
                            <button
                                aria-label="상담 알림 닫기"
                                onClick={() => setOpen(false)}
                            >
                                닫기
                            </button>
                        </header>
                        <p className="text-xs text-muted-foreground">
                            내 담당 문의와 미배정 문의, 멘션·배정·응대 목표
                            알림입니다. 상담을 읽으면 해당 고객 문의 알림도 읽음
                            처리됩니다.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button
                                className={`rounded border px-3 py-1.5 ${unread ? "bg-muted" : ""}`}
                                onClick={() => setUnread((v) => !v)}
                            >
                                {unread ? "전체 보기" : "미확인만 보기"}
                            </button>
                            <button
                                disabled={busy || !rows.some((r) => !r.readAt)}
                                className="rounded border px-3 py-1.5 disabled:opacity-50"
                                onClick={() =>
                                    void read(
                                        rows
                                            .filter((r) => !r.readAt)
                                            .map((r) => r.id),
                                    ).catch(() => {})
                                }
                            >
                                표시된 미확인 모두 읽음
                            </button>
                        </div>
                        {pages.error && (
                            <p role="alert">
                                {pages.error.message}{" "}
                                <button onClick={() => void pages.mutate()}>
                                    다시 불러오기
                                </button>
                            </p>
                        )}
                        {!pages.data && !pages.error && (
                            <p>알림을 불러오는 중…</p>
                        )}
                        {pages.data && !rows.length && (
                            <p className="py-10 text-center text-muted-foreground">
                                {unread
                                    ? "미확인 알림이 없습니다."
                                    : "아직 받은 상담 알림이 없습니다."}
                            </p>
                        )}
                        {rows.map((row) => (
                            <button
                                key={row.id}
                                disabled={busy}
                                className={`block w-full space-y-2 rounded-xl border p-4 text-left ${!row.readAt ? "border-violet-200 bg-violet-50/40" : ""}`}
                                onClick={() => {
                                    void read([row.id])
                                        .then(() => {
                                            setOpen(false);
                                            onSelect(row);
                                        })
                                        .catch(() => {});
                                }}
                            >
                                <span className="flex justify-between gap-2 text-xs">
                                    <strong>
                                        {operationsLabels[row.type] ??
                                            "상담 알림"}
                                    </strong>
                                    <span>
                                        {row.readAt ? "읽음" : "미확인"}
                                    </span>
                                </span>
                                <p className="text-xs text-muted-foreground">
                                    {channels.find(
                                        (c) => c.id === row.channelId,
                                    )?.name ?? "상담함"}
                                </p>
                                <p className="font-medium">{row.name}</p>
                                <p className="line-clamp-2 text-sm text-muted-foreground">
                                    {row.preview}
                                </p>
                                <time className="block text-xs text-muted-foreground">
                                    {operationTime(row.createdAt)}
                                </time>
                            </button>
                        ))}
                        {pages.data?.at(-1)?.hasMore && (
                            <button
                                className="w-full rounded border py-2"
                                onClick={() =>
                                    void pages.setSize(pages.size + 1)
                                }
                            >
                                이전 알림 더 보기
                            </button>
                        )}
                    </section>
                </div>
            )}
        </>
    );
}
