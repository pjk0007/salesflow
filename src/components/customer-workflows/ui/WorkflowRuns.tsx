"use client";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { workflowRequest, workflowWrite } from "../api";
import { useWorkflowPages } from "../hooks/useWorkflowPages";
import type { WorkflowRun, WorkflowRunDetail } from "../types";
import { runLabels } from "../utils/labels";
export function WorkflowRuns({
    id,
    canManage,
    workspaceId,
}: {
    id: string;
    canManage: boolean;
    workspaceId: number;
}) {
    const pages = useWorkflowPages<WorkflowRun>(
            `/api/customer-workflows/${id}/runs`,
            5000,
        ),
        rows = pages.data?.flatMap((p) => p.rows) ?? [],
        [chosen, setChosen] = useState(""),
        [busy, setBusy] = useState(false),
        detail = useSWR<WorkflowRunDetail>(
            chosen ? `/api/customer-workflows/${id}/runs/${chosen}` : null,
            workflowRequest,
            { refreshInterval: chosen ? 3000 : 0 },
        );
    async function change(action: "cancel" | "retry") {
        setBusy(true);
        try {
            await workflowWrite(
                `/api/customer-workflows/${id}/runs/${chosen}`,
                { action },
            );
            await Promise.all([pages.mutate(), detail.mutate()]);
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="space-y-3">
            <h3 className="font-semibold">실행·예약 이력</h3>
            {pages.error && (
                <p role="alert" className="text-red-600">
                    {pages.error.message}
                </p>
            )}
            {!rows.length && (
                <p className="text-xs text-muted-foreground">
                    게시 이후 시작한 실행이 없습니다.
                </p>
            )}
            {rows.map((run) => (
                <button
                    key={run.id}
                    className={`block w-full rounded-lg border p-3 text-left text-xs ${chosen === run.id ? "border-[#635BFF]" : ""}`}
                    onClick={() => setChosen(run.id)}
                >
                    {runLabels[run.state] ?? run.state} ·{" "}
                    {new Date(run.createdAt).toLocaleString("ko-KR")}
                    <span className="mt-1 block text-muted-foreground">
                        처리 단계 {run.cursor}개
                        {[
                            "queued",
                            "running",
                            "waiting",
                            "retry",
                            "failed",
                        ].includes(run.state)
                            ? ` · 현재 단계 시도 ${run.attempts}`
                            : ""}
                        {["waiting", "retry"].includes(run.state)
                            ? ` · 예약 ${new Date(run.eligibleAt).toLocaleString("ko-KR")}`
                            : ""}
                        {run.reason ? ` · ${run.reason}` : ""}
                    </span>
                </button>
            ))}
            {pages.data?.at(-1)?.hasMore && (
                <button
                    className="text-xs underline"
                    onClick={() => void pages.setSize(pages.size + 1)}
                >
                    이전 실행 더 보기
                </button>
            )}
            {chosen && (
                <div className="space-y-3 rounded-lg bg-muted/30 p-3 text-xs">
                    {detail.error && (
                        <p role="alert" className="text-red-600">
                            {detail.error.message}
                        </p>
                    )}
                    {detail.data && (
                        <>
                            <strong>
                                게시 버전 {detail.data.revision.version} ·{" "}
                                {runLabels[detail.data.run.state]}
                            </strong>
                            {detail.data.steps.map((s) => (
                                <div key={s.id} className="border-l-2 pl-3">
                                    <p>
                                        {s.position + 1}.{" "}
                                        {
                                            detail.data!.revision.definition
                                                .steps[s.position]?.label
                                        }{" "}
                                        ·{" "}
                                        {s.kind === "wait" &&
                                        detail.data!.run.state ===
                                            "cancelled" &&
                                        s.state === "waiting"
                                            ? "예약 취소됨"
                                            : s.kind === "wait" &&
                                                [
                                                    "succeeded",
                                                    "skipped",
                                                ].includes(
                                                    detail.data!.run.state,
                                                ) &&
                                                s.state === "waiting"
                                              ? "예약 시간 경과"
                                              : (runLabels[s.state] ?? s.state)}
                                    </p>
                                    {!!s.detail.reason && (
                                        <p className="text-muted-foreground">
                                            {String(s.detail.reason)}
                                        </p>
                                    )}
                                    {!!s.detail.teamName && (
                                        <p className="text-muted-foreground">
                                            상담팀: {String(s.detail.teamName)}{" "}
                                            · 담당:{" "}
                                            {s.detail.assigneeName
                                                ? String(s.detail.assigneeName)
                                                : "팀 대기열"}
                                        </p>
                                    )}
                                    {!!s.detail.waitUntil && (
                                        <p className="text-muted-foreground">
                                            예약:{" "}
                                            {new Date(
                                                String(s.detail.waitUntil),
                                            ).toLocaleString("ko-KR")}
                                        </p>
                                    )}
                                    {!!s.detail.taskId && (
                                        <a
                                            className="mr-3 text-[#635BFF]"
                                            href={`/customer-crm?workspaceId=${workspaceId}&resource=tasks&q=${encodeURIComponent(String(s.detail.title ?? ""))}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            만든 후속 업무 보기 ↗
                                        </a>
                                    )}
                                    {!!s.detail.conversationId &&
                                        !!s.detail.channelId && (
                                            <a
                                                className="text-[#635BFF]"
                                                href={`/inbox?channelId=${String(s.detail.channelId ?? "")}&conversation=${String(s.detail.conversationId)}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                연결 상담 보기 ↗
                                            </a>
                                        )}
                                    <details className="mt-1">
                                        <summary className="cursor-pointer text-muted-foreground">
                                            처리 값 확인
                                        </summary>
                                        <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                                            {JSON.stringify(s.detail, null, 2)}
                                        </pre>
                                    </details>
                                </div>
                            ))}
                            {detail.data.history.map((h) => (
                                <p key={h.id}>
                                    {new Date(h.createdAt).toLocaleString(
                                        "ko-KR",
                                    )}{" "}
                                    · {h.actorName} · {h.action} ·{" "}
                                    {String(h.detail.reason ?? "")}
                                </p>
                            ))}
                            {canManage && (
                                <div className="flex gap-3">
                                    {[
                                        "queued",
                                        "running",
                                        "waiting",
                                        "retry",
                                    ].includes(detail.data.run.state) && (
                                        <button
                                            disabled={busy}
                                            onClick={() =>
                                                void change("cancel")
                                            }
                                            className="underline"
                                        >
                                            이 실행 중단
                                        </button>
                                    )}
                                    {detail.data.run.state === "failed" && (
                                        <button
                                            disabled={busy}
                                            onClick={() => void change("retry")}
                                            className="underline"
                                        >
                                            실패한 단계부터 재시도
                                        </button>
                                    )}
                                </div>
                            )}
                            <details>
                                <summary className="cursor-pointer">
                                    시작 이벤트 원본
                                </summary>
                                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
                                    {JSON.stringify(
                                        detail.data.run.eventSnapshot,
                                        null,
                                        2,
                                    )}
                                </pre>
                            </details>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
