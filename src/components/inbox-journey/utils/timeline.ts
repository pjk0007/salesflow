import type { JourneyEvent } from "@/components/journey/types";

/** 고객의 경로에는 상담별 시작·진행만 표시하고 대화 원문은 중앙 상담 창에 둔다. */
export function customerTimeline(events: JourneyEvent[]): JourneyEvent[] {
    const result: JourneyEvent[] = [];
    const chats = new Map<string, JourneyEvent[]>();
    for (const event of events) {
        if (event.source !== "inbox" || !event.type.startsWith("chat_")) { result.push(event); continue; }
        const id = String(event.meta.conversationId ?? "current");
        const rows = chats.get(id) ?? [];
        rows.push(event); chats.set(id, rows);
    }
    for (const rows of chats.values()) {
        rows.sort((a, b) => a.at.localeCompare(b.at));
        const first = rows[0], last = rows[rows.length - 1];
        const questions = rows.filter(row => row.type === "chat_customer").length;
        const replies = rows.length - questions;
        result.push({ at: first.at, source: "inbox", channel: "상담", type: "conversation_started", label: "상담 시작",
            meta: { questions, replies, lastAt: last.at } });
        if (first.at !== last.at) result.push({ at: last.at, source: "inbox", channel: "상담", type: "conversation_last_activity", label: "최근 상담 진행", meta: { questions, replies } });
    }
    return result.sort((a, b) => a.at.localeCompare(b.at));
}
