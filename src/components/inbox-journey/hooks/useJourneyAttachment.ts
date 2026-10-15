"use client";
import { useEffect, useRef } from "react";
import { inboxRequest } from "@/components/inbox/api";

function contextKey(value: string) {
    try {
        // 재전달 중복 제거용이다. 실제 출처·사업·서명 검증은 서버에서 수행한다.
        const data = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return `${data.siteId}:${data.visitorId}:${data.sessionId}`;
    } catch { return value; }
}

/** 문의를 먼저 보낸 뒤 트래커 응답이 도착해도 현재 문의의 경로를 연결한다. */
export function useJourneyAttachment(options: {
    channelKey: string; token: string; journeyToken?: string;
    conversationId?: string | null; readOnly?: boolean; ready: boolean;
}) {
    const { channelKey, token, journeyToken, conversationId, readOnly, ready } = options;
    const attached = useRef("");
    useEffect(() => {
        if (!ready || !token || !journeyToken || !conversationId || readOnly) return;
        const key = `${channelKey}:${conversationId}:${token}:${contextKey(journeyToken)}`;
        if (attached.current === key) return;
        let active = true;
        void inboxRequest<{ linked: boolean }>(`/api/messenger/${channelKey}`, {
            method: "POST", body: JSON.stringify({ action: "journey", journeyToken, conversationId }),
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        }).then(result => { if (active && result.linked) attached.current = key; })
            .catch(() => { /* 경로 연결이 실패해도 고객 문의와 답변은 유지한다. */ });
        return () => { active = false; };
    }, [channelKey, token, journeyToken, conversationId, readOnly, ready]);
}
