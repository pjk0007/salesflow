"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useCustomerRecord } from "../hooks/useCustomerRecord";
import {
    sourceNames,
    actionNames,
    fieldName,
    changeValue,
} from "../utils/display";
import type { CustomerRecord } from "../types";
export function CustomerRecordPanel({
    workspaceId,
    resource,
    item,
    canManage,
    onChanged,
}: {
    workspaceId: number;
    resource: "contacts" | "companies";
    item: CustomerRecord;
    canManage: boolean;
    onChanged: (item: CustomerRecord) => Promise<unknown>;
}) {
    const [before, setBefore] = useState<string>(),
        [previous, setPrevious] = useState<(string | undefined)[]>([]),
        [review, setReview] = useState(false),
        [reason, setReason] = useState(""),
        [busy, setBusy] = useState(false);
    const state = useCustomerRecord(workspaceId, resource, item.id, before),
        data = state.data,
        stale = !!data && data.item.version > item.version,
        refreshing = !!data && data.item.version < item.version;
    async function apply() {
        setBusy(true);
        try {
            const result = await state.archive(
                item.archivedAt ? "restore" : "archive",
                item.version,
                reason,
            );
            toast.success(
                item.archivedAt
                    ? "보관된 정보를 복구했습니다."
                    : `보관했습니다. 대기 자동화 ${result.cancelledWorkflows}건을 중단했습니다.`,
            );
            setReview(false);
            await onChanged(result.item);
        } catch (e) {
            toast.error((e as Error).message);
            await state.mutate();
        } finally {
            setBusy(false);
        }
    }
    return (
        <section
            aria-label="고객 정보 보관과 변경 이력"
            className="mt-6 space-y-4 border-t pt-5"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">보관과 변경 이력</h3>
                {canManage && (
                    <button
                        type="button"
                        className="rounded border px-3 py-2 text-sm disabled:opacity-40"
                        disabled={busy || !data || stale || refreshing}
                        onClick={() => setReview((r) => !r)}
                    >
                        {item.archivedAt ? "보관 복구" : "보관하기"}
                    </button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                저장 버전 {item.version}
                {item.archivedAt
                    ? ` · ${new Date(item.archivedAt).toLocaleString("ko-KR")} 보관됨`
                    : ""}
            </p>
            {stale && (
                <p
                    role="alert"
                    className="rounded border p-3 text-sm text-amber-800"
                >
                    현재 정보가 버전 {data?.item.version}로 변경됐습니다. 최신
                    내용을 불러온 뒤 저장·보관해주세요.
                </p>
            )}
            {refreshing && (
                <p className="text-sm text-muted-foreground">
                    저장한 정보의 변경 이력을 불러오는 중입니다.
                </p>
            )}
            {state.error && (
                <p role="alert" className="text-sm text-red-700">
                    {state.error.message}{" "}
                    <button type="button" onClick={() => void state.mutate()}>
                        다시 불러오기
                    </button>
                </p>
            )}
            {review && data && (
                <div
                    role="group"
                    aria-label="보관 영향 확인"
                    className="space-y-3 rounded-lg bg-muted p-4 text-sm"
                >
                    <b>
                        {item.archivedAt
                            ? "보관 정보를 복구할까요?"
                            : "현재 저장된 정보를 보관할까요?"}
                    </b>
                    <p>
                        연결 상담 {data.impact.conversations}건 · 보관하지 않은
                        거래 {data.impact.deals}개 · 예정 업무{" "}
                        {data.impact.tasks}개
                    </p>
                    <p>
                        상담·거래·업무와 연결 관계는 유지됩니다. 고객이 다시
                        문의하면 같은 이력으로 응대합니다.
                    </p>
                    <p>
                        {item.archivedAt
                            ? "복구 후 새 이벤트부터 자동화 대상에 포함됩니다. 중단된 이전 자동화는 다시 실행하지 않습니다."
                            : `기본 고객 목록과 새 연결 후보에서 제외하고 대기 자동화 ${data.impact.pendingWorkflows}건을 중단합니다. 실행 시점의 대기 작업까지 포함합니다.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        현재 입력 중인 변경사항은 먼저 저장해주세요.
                    </p>
                    <label className="block">
                        사유 (선택)
                        <textarea
                            aria-label="보관·복구 사유"
                            maxLength={500}
                            className="mt-1 w-full rounded border bg-background p-2"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </label>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            className="rounded border bg-background px-3 py-2"
                            disabled={busy || stale || refreshing}
                            onClick={() => void apply()}
                        >
                            {busy
                                ? "처리 중…"
                                : item.archivedAt
                                  ? "복구 실행"
                                  : "보관 실행"}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setReview(false)}
                        >
                            취소
                        </button>
                    </div>
                </div>
            )}
            {!data && !state.error && (
                <p className="text-sm">이력을 불러오는 중…</p>
            )}
            {data && !data.creationTracked && (
                <p className="text-xs text-muted-foreground">
                    이력 기능 도입 후 변경부터 표시합니다.
                </p>
            )}
            {data && !data.history.length && (
                <p className="text-sm text-muted-foreground">
                    기록된 변경이 없습니다.
                </p>
            )}
            {data?.history.map((h) => (
                <details key={h.id} className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm">
                        <b>{actionNames[h.action] ?? h.action}</b> ·{" "}
                        {h.actorName} · 버전 {h.version}
                        <span className="mt-1 block text-xs text-muted-foreground">
                            {sourceNames[h.source] ?? h.source} ·{" "}
                            {new Date(h.createdAt).toLocaleString("ko-KR")}
                        </span>
                    </summary>
                    {h.reason && (
                        <p className="mt-3 text-sm">사유: {h.reason}</p>
                    )}
                    <div className="mt-3 space-y-3">
                        {Object.entries(h.changes).map(([key, change]) => (
                            <div
                                key={key}
                                className="space-y-1 border-t pt-2 text-xs"
                            >
                                <b>{fieldName(key)}</b>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
                                        이전:{" "}
                                        {changeValue(
                                            change.before,
                                            change.beforePresent,
                                            change.beforeLabel,
                                        )}
                                    </pre>
                                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
                                        변경:{" "}
                                        {changeValue(
                                            change.after,
                                            change.afterPresent,
                                            change.afterLabel,
                                        )}
                                    </pre>
                                </div>
                            </div>
                        ))}
                    </div>
                </details>
            ))}
            <div className="flex gap-4 text-sm">
                <button
                    type="button"
                    disabled={!previous.length}
                    onClick={() => {
                        setBefore(previous.at(-1));
                        setPrevious((p) => p.slice(0, -1));
                    }}
                >
                    이전 이력
                </button>
                <button
                    type="button"
                    disabled={!data?.hasMore}
                    onClick={() => {
                        setPrevious((p) => [...p, before]);
                        setBefore(data?.history.at(-1)?.id);
                    }}
                >
                    다음 이력
                </button>
            </div>
        </section>
    );
}
