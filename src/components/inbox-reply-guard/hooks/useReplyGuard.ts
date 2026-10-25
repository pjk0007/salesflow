"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { loadReplyGuard, writeReplyLease } from "../api";
import type { ReplyGuardContext } from "../types";
export function useReplyGuard(
    channelId: number,
    conversationId: string,
    revision: number,
    userId: string,
    enabled: boolean,
    active: boolean,
    canRespond: boolean,
) {
    const [sessionId] = useState(() => crypto.randomUUID()),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const url = canRespond
        ? `/api/inbox-reply-guard?channelId=${channelId}&conversationId=${conversationId}&sessionId=${sessionId}`
        : null;
    const query = useSWR(
        url ? [url, userId] : null,
        ([u]) => loadReplyGuard(u),
        { refreshInterval: 3000, refreshWhenHidden: false },
    );
    const required = query.data?.enabled ?? enabled,
        lease = query.data?.conversation?.lease,
        mine = !!lease?.isMine && !query.error,
        latest = query.data?.conversation?.revision === revision,
        stale = mine && lease?.baseRevision !== revision;
    const mutate = query.mutate;
    useEffect(() => {
        if (!required || !active || !lease?.isMine) return;
        let disposed = false,
            inFlight = false;
        const input = { conversationId, sessionId, leaseId: lease.id };
        const renew = async () => {
            if (inFlight || document.visibilityState !== "visible") return;
            inFlight = true;
            try {
                const data = await writeReplyLease({
                    ...input,
                    action: "renew",
                });
                if (!disposed) {
                    setError("");
                    await mutate(data, false);
                }
            } catch (e) {
                if (!disposed) {
                    setError((e as Error).message);
                    void mutate().catch(() => {});
                }
            } finally {
                inFlight = false;
            }
        };
        const release = () => {
            void writeReplyLease({ ...input, action: "release" })
                .then(() => {
                    if (!disposed) void mutate().catch(() => {});
                })
                .catch(() => {});
        };
        const visibility = () => {
            // 다른 탭에서 자료를 확인하는 동안은 갱신만 멈추고 서버 TTL을 유지한다.
            if (document.visibilityState === "visible") void mutate().catch(() => {});
        };
        document.addEventListener("visibilitychange", visibility);
        window.addEventListener("pagehide", release);
        const timer = window.setInterval(() => void renew(), 20000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", visibility);
            window.removeEventListener("pagehide", release);
            release();
        };
    }, [
        required,
        active,
        lease?.isMine,
        lease?.id,
        conversationId,
        sessionId,
        mutate,
    ]);
    async function act(
        action: "acquire" | "release" | "acknowledge",
        reason?: string,
    ) {
        setBusy(true);
        setError("");
        try {
            const data = await writeReplyLease(
                action === "acquire"
                    ? {
                          conversationId,
                          sessionId,
                          action,
                          revision,
                          ...(reason && lease
                              ? { takeover: { leaseId: lease.id, reason } }
                              : {}),
                      }
                    : action === "release"
                      ? {
                            conversationId,
                            sessionId,
                            action,
                            leaseId: lease!.id,
                        }
                      : {
                            conversationId,
                            sessionId,
                            action,
                            leaseId: lease!.id,
                            revision,
                        },
            );
            await mutate(data, false);
        } catch (e) {
            setError((e as Error).message);
            void mutate().catch(() => {});
        } finally {
            setBusy(false);
        }
    }
    return {
        required,
        lease,
        mine,
        latest,
        stale,
        busy,
        error: error || query.error?.message,
        canManage: query.data?.canManage ?? false,
        canSend: !required || (mine && latest && !stale && !error),
        context: (): ReplyGuardContext | undefined =>
            required && mine && lease
                ? { leaseId: lease.id, sessionId, revision }
                : undefined,
        begin: (reason?: string) => act("acquire", reason),
        release: () => act("release"),
        acknowledge: () => act("acknowledge"),
        refresh: async () => {
            try {
                await mutate();
                setError("");
            } catch (e) {
                setError((e as Error).message);
            }
        },
    };
}
