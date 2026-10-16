"use client";
import { useState } from "react";
import useSWR from "swr";
import { webhookRequest, webhookWrite } from "../api";
import { useWebhookDeliveries } from "../hooks/useWebhookDeliveries";
import type { DeliveryDetail, WebhookEndpoint } from "../types";
import { eventNames } from "./WebhookEditor";
export const deliveryNames: Record<string, string> = {
    pending: "발송 대기",
    processing: "전달 중",
    retry: "재시도 대기",
    succeeded: "전달 완료",
    dead: "전달 실패",
    cancelled: "취소됨",
};
export function WebhookDeliveries({
    endpoint,
    canManage,
}: {
    endpoint: WebhookEndpoint;
    canManage: boolean;
}) {
    const [state, setState] = useState(""),
        [chosen, setChosen] = useState<string | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const pages = useWebhookDeliveries(endpoint.id, state),
        detail = useSWR<DeliveryDetail>(
            chosen
                ? `/api/customer-platform/webhook-deliveries/${chosen}`
                : null,
            webhookRequest,
            { refreshInterval: 5000 },
        );
    const rows =
        pages.data
            ?.flatMap((p) => p.rows)
            .filter((r, i, all) => all.findIndex((v) => v.id === r.id) === i) ??
        [];
    async function retry() {
        if (!chosen) return;
        setBusy(true);
        setError("");
        try {
            await webhookWrite(
                `/api/customer-platform/webhook-deliveries/${chosen}`,
                { action: "retry" },
            );
            await Promise.all([pages.mutate(), detail.mutate()]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    return (
        <section className="space-y-4 border-t pt-5">
            <div className="flex justify-between">
                <h2 className="font-semibold">전달 이력</h2>
                <select
                    aria-label="전달 상태"
                    value={state}
                    onChange={(e) => {
                        setState(e.target.value);
                        setChosen(null);
                    }}
                    className="rounded-lg border p-1 text-xs"
                >
                    <option value="">전체 상태</option>
                    {Object.entries(deliveryNames).map(([key, value]) => (
                        <option key={key} value={key}>
                            {value}
                        </option>
                    ))}
                </select>
            </div>
            {(pages.error || detail.error || error) && (
                <p role="alert" className="text-sm text-red-600">
                    {error || pages.error?.message || detail.error?.message}
                    <button
                        className="ml-2 underline"
                        onClick={() => {
                            void pages.mutate();
                            void detail.mutate();
                        }}
                    >
                        다시 불러오기
                    </button>
                </p>
            )}
            {!pages.data ? (
                <p className="text-sm">불러오는 중…</p>
            ) : !rows.length ? (
                <p className="rounded-xl bg-muted p-5 text-sm text-muted-foreground">
                    전달 이력이 없습니다. 전송을 켜면 선택한 이후의 이벤트부터
                    모읍니다.
                </p>
            ) : (
                <ul className="divide-y rounded-xl border">
                    {rows.map((row) => (
                        <li key={row.id}>
                            <button
                                className={`flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-xs ${chosen === row.id ? "bg-violet-50" : ""}`}
                                onClick={() => setChosen(row.id)}
                            >
                                <span>
                                    <strong className="block text-sm">
                                        {eventNames[row.type] ?? row.type}
                                    </strong>
                                    {new Date(row.createdAt).toLocaleString(
                                        "ko-KR",
                                    )}
                                </span>
                                <span>
                                    {deliveryNames[row.state]} · {row.attempts}
                                    회
                                    {row.lastStatus
                                        ? ` · HTTP ${row.lastStatus}`
                                        : ""}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {pages.data?.at(-1)?.hasMore && (
                <button
                    className="text-sm text-[#635BFF]"
                    disabled={pages.isValidating}
                    onClick={() => void pages.setSize(pages.size + 1)}
                >
                    이전 전달 더 보기
                </button>
            )}
            {detail.data && (
                <article
                    aria-label="전달 상세"
                    className="space-y-3 rounded-xl border p-4 text-xs"
                >
                    <div className="flex justify-between">
                        <h3 className="font-semibold">
                            {deliveryNames[detail.data.delivery.state]}
                        </h3>
                        <button onClick={() => setChosen(null)}>닫기</button>
                    </div>
                    <p className="break-all text-muted-foreground">
                        이벤트 {detail.data.delivery.eventId}
                    </p>
                    {detail.data.delivery.lastError && (
                        <p className="text-red-600">
                            {detail.data.delivery.lastError}
                        </p>
                    )}
                    {detail.data.delivery.state === "retry" && (
                        <p>
                            다음 재시도:{" "}
                            {new Date(
                                detail.data.delivery.availableAt,
                            ).toLocaleString("ko-KR")}
                        </p>
                    )}
                    {canManage &&
                        ["retry", "dead", "cancelled"].includes(
                            detail.data.delivery.state,
                        ) && (
                            <button
                                disabled={busy || !endpoint.enabled}
                                className="rounded-lg border px-3 py-2 disabled:opacity-40"
                                onClick={() => void retry()}
                            >
                                {busy ? "처리 중…" : "이 이벤트 다시 전달"}
                            </button>
                        )}
                    <h4 className="font-semibold">시도 기록</h4>
                    {!detail.data.attempts.length ? (
                        <p>아직 전달을 시도하지 않았습니다.</p>
                    ) : (
                        detail.data.attempts.map((a) => (
                            <p key={a.id}>
                                {a.attempt}회 ·{" "}
                                {new Date(a.startedAt).toLocaleString("ko-KR")}{" "}
                                ·{" "}
                                {a.state === "succeeded"
                                    ? "성공"
                                    : a.state === "failed"
                                      ? "실패"
                                      : a.state === "unknown"
                                        ? "결과 미확인"
                                        : "전달 중"}
                                {a.status ? ` · HTTP ${a.status}` : ""}
                                {a.error ? ` · ${a.error}` : ""}
                                <small className="block break-all text-muted-foreground">
                                    {a.url}
                                </small>
                            </p>
                        ))
                    )}
                    <details>
                        <summary className="cursor-pointer">
                            개발 연동 데이터
                        </summary>
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">
                            {JSON.stringify(detail.data.payload, null, 2)}
                        </pre>
                    </details>
                </article>
            )}
        </section>
    );
}
