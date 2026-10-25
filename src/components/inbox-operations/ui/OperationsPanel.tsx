"use client";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";
import { useOperationsReport } from "../hooks/useOperations";
import { dayString, durationText, operationTime } from "../utils/display";
import type { OpenSupportConversation } from "../types";
import { OperationsSettingsEditor } from "./OperationsSettingsEditor";
function Report({
    channelId,
    onSelect,
}: {
    channelId: number;
    onSelect: OpenSupportConversation;
}) {
    const [from, setFrom] = useState(() =>
            dayString(new Date(Date.now() - 6 * 86400000)),
        ),
        [to, setTo] = useState(() => dayString(new Date())),
        [medium, setMedium] = useState("all"),
        [cursor, setCursor] = useState<string | undefined>(),
        [previous, setPrevious] = useState<(string | undefined)[]>([]),
        { data, error, mutate } = useOperationsReport(
            channelId,
            from,
            to,
            medium,
            cursor,
        );
    const reset = () => {
        setCursor(undefined);
        setPrevious([]);
    };
    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                    시작일
                    <input
                        type="date"
                        aria-label="성과 시작일"
                        className="ml-2 rounded border p-2"
                        value={from}
                        onChange={(e) => {
                            setFrom(e.target.value);
                            reset();
                        }}
                    />
                </label>
                <label className="text-sm">
                    종료일
                    <input
                        type="date"
                        aria-label="성과 종료일"
                        className="ml-2 rounded border p-2"
                        value={to}
                        onChange={(e) => {
                            setTo(e.target.value);
                            reset();
                        }}
                    />
                </label>
                <select
                    aria-label="성과 상담 매체"
                    className="rounded border p-2"
                    value={medium}
                    onChange={(e) => {
                        setMedium(e.target.value);
                        reset();
                    }}
                >
                    <option value="all">웹·이메일 전체</option>
                    <option value="web">웹 상담</option>
                    <option value="email">이메일</option>
                </select>
                <button
                    className="rounded border p-2 text-sm"
                    onClick={() => void mutate()}
                >
                    새로고침
                </button>
            </div>
            {error && <p role="alert">{error.message}</p>}
            {!data && !error && <p>성과를 불러오는 중…</p>}
            {data && (
                <>
                    <p className="text-xs text-muted-foreground">
                        {data.period.timezone} · 선택 기간에 시작한 응대 기준.
                        재문의로 새 응대가 열리면 별도 집계합니다. 소요시간은
                        해당 응대에 적용된 업무시간·보류 기준으로 계산합니다.
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {[
                            ["시작한 응대", String(data.summary.started)],
                            [
                                "진행 / 종료",
                                `${data.summary.open} / ${data.summary.closed}`,
                            ],
                            [
                                "첫 답변 중앙값",
                                durationText(data.summary.firstReplyMedianMs),
                            ],
                            [
                                "해결 중앙값",
                                durationText(data.summary.resolutionMedianMs),
                            ],
                        ].map(([name, value]) => (
                            <div key={name} className="rounded-xl border p-4">
                                <p className="text-xs text-muted-foreground">
                                    {name}
                                </p>
                                <strong className="mt-2 block text-xl">
                                    {value}
                                </strong>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        첫 답변 표본 {data.summary.firstReplySamples} · 해결
                        표본 {data.summary.resolutionSamples} · 첫 응답 AI{" "}
                        {data.summary.aiFirst} · 미응답을 남긴 종료{" "}
                        {data.summary.closedUnanswered} · 보류{" "}
                        {data.summary.paused}
                    </p>
                    {data.coverage.untracked > 0 && (
                        <p role="status" className="rounded border p-3 text-sm">
                            이 기간에 문의한 상담 중 {data.coverage.untracked}
                            건은 지표 도입 전 이력입니다. 응대 지표에 포함하지
                            않았습니다.
                        </p>
                    )}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <caption className="mb-2 text-left font-semibold">
                                응대 목표 결과
                            </caption>
                            <thead>
                                <tr className="border-b">
                                    <th className="p-2">목표</th>
                                    <th>적용</th>
                                    <th>준수</th>
                                    <th>초과</th>
                                    <th>답변 대기 · 전체</th>
                                    <th>미응답 종료 · 전체</th>
                                    <th>소요 중앙값</th>
                                </tr>
                            </thead>
                            <tbody>
                                {["first", "next"].map((kind) => {
                                    const r = data.response.find(
                                        (r) => r.kind === kind,
                                    );
                                    return (
                                        <tr key={kind} className="border-b">
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
                    </div>
                    <p className="text-xs text-muted-foreground">
                        준수·초과는 목표가 있는 응대 기준입니다. 대기·미응답
                        종료와 소요시간 표본은 전체 응대 기준이며, 초과한 응대가
                        대기에도 포함될 수 있습니다.
                    </p>
                    <div className="grid gap-5 lg:grid-cols-2">
                        <section>
                            <h3 className="mb-2 font-semibold">일별 응대</h3>
                            {data.daily.length ? (
                                data.daily.map((d) => (
                                    <p
                                        key={d.day}
                                        className="border-b py-2 text-sm"
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
                        <section>
                            <h3 className="mb-2 font-semibold">담당자별</h3>
                            <p className="text-xs text-muted-foreground">
                                종료 응대는 종료 당시 담당자, 진행 응대는 현재
                                담당자 기준입니다.
                            </p>
                            {data.teammates.map((t, i) => (
                                <p
                                    key={t.id ?? i}
                                    className="border-b py-2 text-sm"
                                >
                                    {t.name ?? "담당자 없음"} · 시작 {t.started}{" "}
                                    / 종료 {t.closed} · 첫 답변{" "}
                                    {durationText(t.firstReplyMedianMs)}
                                </p>
                            ))}
                        </section>
                    </div>
                    <section>
                        <h3 className="mb-3 font-semibold">응대별 확인</h3>
                        <div className="space-y-2">
                            {data.rows.map((row) => (
                                <button
                                    key={row.id}
                                    className="flex w-full flex-wrap justify-between gap-2 rounded-lg border p-3 text-left text-sm"
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
                                <button
                                    className="rounded border p-2"
                                    onClick={() => {
                                        setCursor(previous.at(-1));
                                        setPrevious(previous.slice(0, -1));
                                    }}
                                >
                                    이전 페이지
                                </button>
                            )}
                            {data.hasMore && (
                                <button
                                    className="rounded border p-2"
                                    onClick={() => {
                                        setPrevious([...previous, cursor]);
                                        setCursor(data.rows.at(-1)?.id);
                                    }}
                                >
                                    다음 응대 100건
                                </button>
                            )}
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
export function OperationsPanel({
    channelId,
    name,
    canManage,
    onClose,
    onSelect,
}: {
    channelId: number;
    name: string;
    canManage: boolean;
    onClose: () => void;
    onSelect: OpenSupportConversation;
}) {
    const [tab, setTab] = useState("report");
    return (
        <Sheet open onOpenChange={(next) => !next && onClose()}>
            <SheetContent
                side="right"
                showCloseButton={false}
                aria-describedby={undefined}
                className="block h-full w-full space-y-6 overflow-y-auto bg-background p-6 sm:max-w-5xl"
            >
                <header className="flex items-center justify-between">
                    <div>
                        <SheetTitle className="text-lg font-semibold">
                            상담 운영과 성과
                        </SheetTitle>
                        <p className="text-sm text-muted-foreground">{name}</p>
                    </div>
                    <button aria-label="상담 운영 닫기" onClick={onClose}>
                        닫기
                    </button>
                </header>
                <nav aria-label="상담 운영 메뉴" className="flex gap-2">
                    {[
                        ["report", "응대 성과"],
                        ["settings", "업무시간·응대 목표"],
                    ].map(([key, label]) => (
                        <button
                            key={key}
                            className={`rounded-lg border px-4 py-2 text-sm ${tab === key ? "bg-violet-50 font-medium" : ""}`}
                            onClick={() => setTab(key)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
                {tab === "report" ? (
                    <Report
                        channelId={channelId}
                        onSelect={(row) => {
                            onClose();
                            onSelect(row);
                        }}
                    />
                ) : (
                    <OperationsSettingsEditor
                        channelId={channelId}
                        canManage={canManage}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}
