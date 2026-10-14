"use client";
import useSWRInfinite from "swr/infinite";
import { crmRequest } from "../api";
import type { DealHistory, Deal } from "../types";
export function ActivityTimeline({
    workspaceId,
    id,
    kind,
}: {
    workspaceId: number;
    id: string;
    kind: "deals" | "contacts";
}) {
    type Event = {
        id: string;
        name: string;
        source: string;
        properties: Record<string, unknown>;
        occurredAt: string;
    };
    type Page = { item: Deal; history: DealHistory[] } | Event[];
    const rowsFor = (page: Page) => (Array.isArray(page) ? page : page.history);
    const pages = useSWRInfinite<Page>((index, previous: Page | null) => {
        const rows = previous ? rowsFor(previous) : [];
        if (index && rows.length !== 100) return null;
        const params = new URLSearchParams({
            workspaceId: String(workspaceId),
        });
        if (index) params.set("before", rows.at(-1)!.id);
        return `/api/customer-crm/${kind}/${id}${kind === "contacts" ? "/events" : ""}?${params}`;
    }, crmRequest);
    const rows =
        pages.data?.flatMap(
            (page) => rowsFor(page) as (DealHistory | Event)[],
        ) ?? [];
    return (
        <section className="mt-8 border-t pt-5">
            <h3 className="mb-4 font-semibold">
                {kind === "deals" ? "변경 이력" : "고객 행동"}
            </h3>
            {pages.error && (
                <p role="alert" className="text-sm text-red-600">
                    {pages.error.message}
                </p>
            )}
            {pages.isLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중…</p>
            ) : !rows.length ? (
                <p className="text-sm text-muted-foreground">
                    아직 기록이 없습니다.
                </p>
            ) : (
                <ol className="space-y-4">
                    {rows.map((row) => (
                        <li
                            key={row.id}
                            className="rounded-lg bg-muted/40 p-3 text-sm"
                        >
                            {"change" in row ? (
                                <>
                                    <p>
                                        {row.actorName} ·{" "}
                                        {{
                                            created: "딜 생성",
                                            updated: "딜 수정",
                                            archived: "보관",
                                            restored: "복원",
                                        }[row.change.action] ??
                                            row.change.action}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {row.change.stage?.name} ·{" "}
                                        {new Date(row.createdAt).toLocaleString(
                                            "ko-KR",
                                        )}
                                    </p>
                                    {row.change.before?.stageId !==
                                        row.change.after?.stageId &&
                                        row.change.action === "updated" && (
                                            <p className="mt-1 text-xs">
                                                영업 단계가 변경됐습니다.
                                            </p>
                                        )}
                                </>
                            ) : (
                                <>
                                    <p>
                                        {row.name}{" "}
                                        <span className="text-xs text-muted-foreground">
                                            {row.source === "web"
                                                ? "사이트"
                                                : "서버"}
                                        </span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {new Date(
                                            row.occurredAt,
                                        ).toLocaleString("ko-KR")}
                                    </p>
                                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                                        {JSON.stringify(
                                            row.properties,
                                            null,
                                            2,
                                        )}
                                    </pre>
                                </>
                            )}
                        </li>
                    ))}
                </ol>
            )}
            {pages.data && rowsFor(pages.data.at(-1)!).length === 100 && (
                <button
                    className="mt-3 text-sm text-violet-600"
                    onClick={() => void pages.setSize(pages.size + 1)}
                >
                    이전 기록 더 보기
                </button>
            )}
        </section>
    );
}
