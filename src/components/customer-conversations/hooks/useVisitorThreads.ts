"use client";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
import type { SendbCustomerMessages } from "../../../../sdk/messenger";

export type VisitorThread = {
    token: string;
    status: SendbCustomerMessages["status"];
    lastBody: string;
    lastAt: string | null;
    lastKind: "customer" | "reply" | null;
};

const read = (key: string): string[] => {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
    } catch {
        return [];
    }
};

/**
 * 비회원 고객의 여러 대화 — 비회원은 대화마다 연결(token)이 따로라, 이 브라우저가 연 대화들의 token을 기억해 목록으로 보여준다.
 * 진행 중(종료 아님)이고 메시지가 있는 대화만 rows에 넣는다.
 */
export function useVisitorThreads(storageKey: string, baseUrl: string, enabled: boolean) {
    const key = `${storageKey}:threads`;
    const [tokens, setTokens] = useState<string[]>(() => (typeof window === "undefined" ? [] : read(key)));
    const save = useCallback(
        (next: string[]) => {
            setTokens(next);
            try {
                localStorage.setItem(key, JSON.stringify(next.slice(0, 20)));
            } catch {}
        },
        [key],
    );
    const add = useCallback((token: string) => {
        const current = read(key);
        if (!current.includes(token)) save([token, ...current]);
    }, [key, save]);
    const remove = useCallback((token: string) => save(read(key).filter((t) => t !== token)), [key, save]);
    const swr = useSWR(
        enabled && tokens.length ? ["visitor-threads", baseUrl, key, tokens.join(",")] : null,
        async () => {
            // 다른 화면에서 막 추가된 대화도 빠지지 않게 저장된 목록을 그때그때 다시 읽는다
            const rows = await Promise.all(
                read(key).map(async (token): Promise<VisitorThread | null> => {
                    try {
                        const d = await inboxRequest<SendbCustomerMessages>(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
                        const last = d.messages.at(-1);
                        if (!d.conversationId || !last) return null;
                        return { token, status: d.status, lastBody: last.body || "첨부 파일", lastAt: String(last.createdAt), lastKind: last.kind };
                    } catch {
                        return null;
                    }
                }),
            );
            return rows.filter((r): r is VisitorThread => !!r && r.status !== "closed");
        },
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
    return { tokens, add, remove, rows: swr.data ?? [], loading: swr.isLoading, refresh: swr.mutate };
}
