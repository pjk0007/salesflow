"use client";
import { useState } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { useOperationsReport } from "../hooks/useOperations";
import { useStatsFilters, type StatsFilters } from "../hooks/useStatsFilters";
import { durationText, operationTime } from "../utils/display";
import { COUNT_METRICS, TREND_METRICS } from "../utils/metrics";
import type { OpenSupportConversation } from "../types";
import { StatsDateBar, StatsMediumBar } from "./StatsFilterBar";
import { StatsCompare } from "./StatsCompare";
import { CountCard, TrendMetricCard } from "./TrendMetricCard";
/** 응대 목표 결과 표 머리 — 이름, 설명 */
const GOAL_COLUMNS: Array<[string, string]> = [
    ["목표", ""],
    ["적용", "응대 목표 시간이 걸린 응대 수예요. 목표가 꺼져 있던 응대는 빠져요."],
    ["준수", "목표 시간 안에 답하거나 해결한 수예요."],
    ["초과", "목표 시간을 넘긴 수예요. 아직 답하지 않았지만 이미 시간을 넘긴 것도 포함해요."],
    ["답변 대기 · 전체", "아직 답하지 않았고 종료되지도 않은 수예요. 목표가 없는 응대도 포함해요."],
    ["미응답 종료 · 전체", "답하지 않은 채 종료된 수예요. 목표가 없는 응대도 포함해요."],
    ["소요 중앙값", "답하거나 해결하기까지 걸린 시간의 중앙값이에요. 업무시간 밖·보류 시간은 빼요."],
];
function Report({
    channelId,
    f,
    onSelect,
}: {
    channelId: number;
    f: StatsFilters;
    onSelect: OpenSupportConversation;
}) {
    const [cursor, setCursor] = useState<string | undefined>(),
        [previous, setPrevious] = useState<(string | undefined)[]>([]),
        { data, error } = useOperationsReport(channelId, f.groups ? f.groups[0].query : f.query, cursor),
        // 이전 같은 길이 기간 — 카드의 증감 표시용
        before = useOperationsReport(channelId, f.groups ? null : f.previous).data;
    return (
        <div className="space-y-5">
            {error && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
            {f.groups && <StatsCompare channelId={channelId} groups={f.groups} />}
            {!data && !error && !f.groups && <p className="text-sm text-muted-foreground">성과를 불러오는 중…</p>}
            {data && (
                <>
                    {!f.groups && (
                        <>
                            <div className="grid gap-3 lg:grid-cols-2">
                                {TREND_METRICS.map((m) => (
                                    <TrendMetricCard key={m.key} m={m} report={data} previous={before} />
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                {COUNT_METRICS.map((m) => (
                                    <CountCard key={m.key} m={m} report={data} previous={before} />
                                ))}
                            </div>
                        </>
                    )}
                    {f.groups && (
                        <p className="text-xs text-muted-foreground">
                            아래 목표 결과·담당자별·응대별 목록은 A 기준이에요.
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {data.period.timezone} · 선택 기간에 시작한 응대 기준 · 첫 답변 표본{" "}
                        {data.summary.firstReplySamples} · 응답 표본{" "}
                        {data.summary.responseSamples} · 종료 표본{" "}
                        {data.summary.resolutionSamples} · 미응답을 남긴 종료{" "}
                        {data.summary.closedUnanswered} · 보류{" "}
                        {data.summary.paused}
                    </p>
                    {data.coverage.untracked > 0 && (
                        <p role="status" className="rounded-lg border border-border/40 bg-card p-3 text-sm">
                            이 기간에 문의한 상담 중 {data.coverage.untracked}
                            건은 지표 도입 전 이력입니다. 응대 지표에 포함하지
                            않았습니다.
                        </p>
                    )}
                    <section className="overflow-x-auto rounded-lg border border-border/40 bg-card p-5">
                        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                            응대 목표 결과
                            <InfoTip text={"업무시간·응대 목표 탭에서 정한 목표 시간을 지켰는지 봐요.\n준수·초과는 목표가 있는 응대 기준이고, 대기·미응답 종료와 소요시간은 전체 응대 기준이에요.\n초과한 응대가 대기에도 포함될 수 있어요."} />
                        </h2>
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs text-muted-foreground">
                                <tr className="border-b border-border/40">
                                    {GOAL_COLUMNS.map(([name, tip], i) => (
                                        <th key={name} className={i ? "py-2 font-medium" : "p-2 font-medium"}>
                                            <span className="inline-flex items-center gap-1">
                                                {name}
                                                {tip && <InfoTip text={tip} />}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {["first", "next"].map((kind) => {
                                    const r = data.response.find(
                                        (r) => r.kind === kind,
                                    );
                                    return (
                                        <tr key={kind} className="border-b border-border/40">
                                            <td className="p-2">
                                                {kind === "first"
                                                    ? "첫 답변"
                                                    : "추가 답변"}
                                            </td>
                                            <td>{r?.targets ?? 0}</td>
                                            <td>{r?.met ?? 0}</td>
                                            <td
                                                className={
                                                    (r?.missed ?? 0) > 0
                                                        ? "font-semibold text-red-700"
                                                        : ""
                                                }
                                            >
                                                {r?.missed ?? 0}
                                            </td>
                                            <td>{r?.awaiting ?? 0}</td>
                                            <td>{r?.closedUnanswered ?? 0}</td>
                                            <td>
                                                {durationText(
                                                    r?.medianMs ?? null,
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                <tr>
                                    <td className="p-2">해결</td>
                                    <td>{data.summary.resolutionTargets}</td>
                                    <td>{data.summary.resolutionMet}</td>
                                    <td
                                        className={
                                            data.summary.resolutionMissed
                                                ? "font-semibold text-red-700"
                                                : ""
                                        }
                                    >
                                        {data.summary.resolutionMissed}
                                    </td>
                                    <td>{data.summary.open}</td>
                                    <td>{data.summary.closedUnanswered}</td>
                                    <td>
                                        {durationText(
                                            data.summary.resolutionMedianMs,
                                        )}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </section>
                    <div className="grid gap-3 lg:grid-cols-2">
                        <section className="rounded-lg border border-border/40 bg-card p-5">
                            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                                일별 응대
                                <InfoTip text={"날마다 시작한 응대와 그중 종료한 응대, 첫 답변 시간 중앙값이에요.\n응대가 시작된 날 기준으로 묶어요."} />
                            </h2>
                            {data.daily.length ? (
                                data.daily.map((d) => (
                                    <p
                                        key={d.day}
                                        className="border-b border-border/40 py-2 text-sm last:border-0"
                                    >
                                        {d.day} · 시작 {d.started} / 종료{" "}
                                        {d.closed} · 첫 답변{" "}
                                        {durationText(d.firstReplyMedianMs)}
                                    </p>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    이 기간에 시작한 응대가 없습니다.
                                </p>
                            )}
                        </section>
                        <section className="rounded-lg border border-border/40 bg-card p-5">
                            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                                담당자별
                                <InfoTip text={"종료한 응대는 종료 당시 담당자, 진행 중인 응대는 지금 담당자 기준이에요.\n이관은 응대 중에 담당자가 바뀐 응대 수예요."} />
                            </h2>
                            {data.teammates.map((t, i) => (
                                <p
                                    key={t.id ?? i}
                                    className="border-b border-border/40 py-2 text-sm last:border-0"
                                >
                                    {t.name ?? "담당자 없음"} · 시작 {t.started}{" "}
                                    / 종료 {t.closed} · 첫 답변{" "}
                                    {durationText(t.firstReplyMedianMs)} · 평균 응답{" "}
                                    {durationText(t.responseAvgMs)}
                                    {t.transferred > 0 && ` · 이관 ${t.transferred}`}
                                </p>
                            ))}
                        </section>
                    </div>
                    <section className="rounded-lg border border-border/40 bg-card p-5">
                        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                            응대별 확인
                            <InfoTip text={"최근에 시작한 응대부터 100건씩 보여줘요.\n누르면 그 상담으로 이동해요."} />
                        </h2>
                        <div className="space-y-2">
                            {data.rows.map((row) => (
                                <button
                                    key={row.id}
                                    className="flex w-full flex-wrap justify-between gap-2 rounded-md border border-border/40 p-3 text-left text-sm hover:bg-muted/50"
                                    onClick={() => onSelect(row)}
                                >
                                    <span>
                                        <strong>{row.name}</strong> ·{" "}
                                        {row.medium === "email"
                                            ? "이메일"
                                            : "웹"}{" "}
                                        · {row.closedAt ? "종료" : "진행"}
                                        <time className="mt-1 block text-xs text-muted-foreground">
                                            {operationTime(row.startedAt)}
                                        </time>
                                    </span>
                                    <span className="text-xs">
                                        첫 답변 {durationText(row.firstReplyMs)}{" "}
                                        / 해결 {durationText(row.resolutionMs)}
                                        {row.resolutionMissed && (
                                            <strong className="ml-2 text-red-700">
                                                해결 목표 초과
                                            </strong>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 flex gap-2">
                            {!!previous.length && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setCursor(previous.at(-1));
                                        setPrevious(previous.slice(0, -1));
                                    }}
                                >
                                    이전 페이지
                                </Button>
                            )}
                            {data.hasMore && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setPrevious([...previous, cursor]);
                                        setCursor(data.rows.at(-1)?.id);
                                    }}
                                >
                                    다음 응대 100건
                                </Button>
                            )}
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
/** 상담통계 화면 본문 — 응대 성과 (업무시간·응대 목표는 상담 설정으로 옮김) */
export function OperationsView({
    channelId,
    onSelect,
}: {
    channelId: number;
    onSelect: OpenSupportConversation;
}) {
    const f = useStatsFilters();
    // 기간·매체가 바뀌면 응대별 목록 페이지는 처음부터
    const filterKey = JSON.stringify([f.query, f.groups?.map((g) => g.query)]);
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">상담통계</h1>
                <StatsDateBar f={f} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <StatsMediumBar f={f} />
                {!f.groups && <p className="text-xs text-muted-foreground">{f.periodText}</p>}
            </div>
            <Report key={filterKey} channelId={channelId} f={f} onSelect={onSelect} />
        </div>
    );
}
