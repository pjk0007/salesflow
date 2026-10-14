"use client";
import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { inboxRequest } from "../api";
type Row = {
    id: string;
    actorName: string;
    action: string;
    changes: Record<
        string,
        {
            before: unknown;
            after: unknown;
            beforeLabel?: string;
            afterLabel?: string;
        }
    >;
    createdAt: string;
};
const fields: Record<string, string> = {
    aiState: "응대 방식",
    aiHandoffReason: "사람 이관 사유",
    status: "상태",
    assigneeId: "담당자",
    recordId: "CRM 연결",
    tags: "태그",
    priority: "중요 표시",
    name: "상담창 이름",
    greeting: "인사말",
    color: "색상",
    allowedOrigins: "설치 도메인",
    enabled: "상담창 사용",
};
function label(value: unknown) {
    if (value === null) return "없음";
    if (typeof value === "boolean") return value ? "켜짐" : "꺼짐";
    if (Array.isArray(value)) return value.join(", ") || "없음";
    return (
        (
            {
                open: "진행중",
                snoozed: "보류중",
                closed: "종료됨",
                auto: "AI 응대 허용",
                human: "사람 응대",
            } as Record<string, string>
        )[String(value)] ?? String(value)
    );
}
export function InboxAudit({ url }: { url: string }) {
    const [opened, setOpened] = useState(false);
    const data = useSWRInfinite<{ rows: Row[]; hasMore: boolean }>(
        (index, previous) =>
            !opened || (previous && !previous.hasMore)
                ? null
                : url + (index ? `?before=${previous!.rows.at(-1)!.id}` : ""),
        inboxRequest,
        { refreshInterval: opened ? 5000 : 0 },
    );
    const rows =
        data.data
            ?.flatMap((p) => p.rows)
            .filter((r, i, all) => all.findIndex((c) => c.id === r.id) === i) ??
        [];
    return (
        <details
            onToggle={(e) => setOpened(e.currentTarget.open)}
            className="space-y-3 border-t pt-4"
        >
            <summary className="cursor-pointer font-semibold">
                변경 이력
            </summary>
            {data.error ? (
                <div role="alert" className="text-xs text-red-600">
                    {data.error.message}
                    <button onClick={() => void data.mutate()}>
                        다시 불러오기
                    </button>
                </div>
            ) : !data.data ? (
                <p className="text-xs">불러오는 중…</p>
            ) : !rows.length ? (
                <p className="text-xs text-muted-foreground">
                    변경 이력이 없습니다.
                </p>
            ) : (
                rows.map((row) => (
                    <article
                        key={row.id}
                        className="space-y-1 border-l-2 pl-3 text-xs"
                    >
                        <p className="font-medium">
                            {row.actorName}
                            {row.action === "customer.reopened"
                                ? " · 재문의로 상담 재개"
                                : ""}
                        </p>
                        <time className="text-muted-foreground">
                            {new Date(row.createdAt).toLocaleString("ko-KR")}
                        </time>
                        {Object.entries(row.changes).map(([key, value]) => (
                            <p key={key} className="break-words">
                                {fields[key] ?? key}:{" "}
                                {value.beforeLabel ?? label(value.before)} →{" "}
                                {value.afterLabel ?? label(value.after)}
                            </p>
                        ))}
                    </article>
                ))
            )}
            {data.data?.at(-1)?.hasMore && (
                <button
                    className="text-xs text-[#635BFF]"
                    disabled={data.isValidating}
                    onClick={() => void data.setSize(data.size + 1)}
                >
                    이전 변경 더 보기
                </button>
            )}
        </details>
    );
}
