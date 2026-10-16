import type { InboxPresence } from "../types";
export function ConversationPresence({
    agents,
    userId,
}: {
    agents: InboxPresence["agents"];
    userId: string;
}) {
    const others = agents.filter(
        (a) => a.id !== userId && a.online && a.activity,
    );
    if (!others.length) return null;
    const writing = others.some((a) => a.activity === "reply");
    return (
        <div
            role="status"
            aria-label="다른 직원의 상담 활동"
            className={`mx-4 mt-2 rounded-xl px-3 py-2 text-xs ${writing ? "bg-amber-50 text-amber-900" : "bg-muted text-muted-foreground"}`}
        >
            {others.map((a) => (
                <p key={a.id}>
                    {a.name}님이{" "}
                    {a.activity === "reply"
                        ? "고객 답변을 작성 중입니다."
                        : a.activity === "note"
                          ? "내부 메모를 작성 중입니다."
                          : "이 상담을 보고 있습니다."}
                </p>
            ))}
            {writing && (
                <p className="mt-1">
                    답변이 겹치지 않도록 최신 대화를 확인해주세요.
                </p>
            )}
        </div>
    );
}
