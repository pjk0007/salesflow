"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { loadPresence, sendPresence, saveAvailability } from "../api";
import type { AgentActivity } from "../types";
export function useAgentPresence(
    channelId: number | null,
    conversationId: string | null,
    userId: string,
) {
    const url = channelId
        ? `/api/inbox-presence?channelId=${channelId}${conversationId ? `&conversationId=${conversationId}` : ""}`
        : null;
    const query = useSWR(url ? [url, userId] : null, ([u]) => loadPresence(u), {
        refreshInterval: conversationId ? 3000 : 15000,
        refreshWhenHidden: false,
    });
    const [connectionError, setConnectionError] = useState("");
    const touch = useRef<(activity: AgentActivity | null) => void>(() => {});
    const mutate = query.mutate;
    useEffect(() => {
        if (!channelId) return;
        const sessionId = crypto.randomUUID();
        let sequence = 0,
            inputAt = 0,
            kind: AgentActivity = "viewing",
            previous: AgentActivity = "viewing",
            sentAt = 0,
            inFlight = false,
            disposed = false;
        const current = (): AgentActivity =>
            conversationId && Date.now() - inputAt < 8000 ? kind : "viewing";
        async function transmit(leave = false) {
            if (!leave && (inFlight || document.visibilityState !== "visible"))
                return;
            const activity = leave ? "viewing" : current();
            if (!leave) inFlight = true;
            previous = activity;
            sentAt = Date.now();
            try {
                await sendPresence({
                    channelId: channelId!,
                    sessionId,
                    sequence: ++sequence,
                    conversationId,
                    activity,
                    leave,
                });
                if (!disposed) {
                    setConnectionError("");
                    void mutate().catch(() => {});
                }
            } catch (e) {
                if (!disposed) setConnectionError((e as Error).message);
            } finally {
                if (!leave) inFlight = false;
            }
        }
        touch.current = (activity) => {
            kind = activity ?? "viewing";
            inputAt = activity ? Date.now() : 0;
            if (current() !== previous) void transmit();
        };
        const visibility = () => {
            inputAt = 0;
            void transmit(document.visibilityState !== "visible");
        };
        document.addEventListener("visibilitychange", visibility);
        void transmit();
        const timer = window.setInterval(() => {
            if (
                current() !== "viewing" ||
                current() !== previous ||
                Date.now() - sentAt >= 28000
            )
                void transmit();
        }, 4000);
        return () => {
            disposed = true;
            touch.current = () => {};
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", visibility);
            void transmit(true);
        };
    }, [channelId, conversationId, userId, mutate]);
    const activity = useCallback(
        (value: AgentActivity | null) => touch.current(value),
        [],
    );
    async function update(state: "available" | "away") {
        if (!channelId || !query.data) return;
        try {
            await saveAvailability({
                channelId,
                state,
                version: query.data.me.version,
            });
        } finally {
            await query.mutate();
        }
    }
    return {
        ...query,
        agents: query.error ? [] : (query.data?.agents ?? []),
        activity,
        update,
        connectionError,
    };
}
