"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { supportRequest, supportWrite } from "../api";
import { useSupportJobs } from "../hooks/useSupportJobs";
import type { SupportJobDetail } from "../types";
import type { Conversation, ChatMessage } from "@/components/inbox/types";
import {
    supportJobCreatedAt,
    supportJobProvenance,
    supportProvenanceNames,
} from "../utils/job-provenance";
export const supportStateNames: Record<string, string> = {
    queued: "생성 대기",
    generating: "생성·근거 검토 중",
    ready: "초안 준비됨",
    handed_off: "상담원 확인 필요",
    failed: "생성 중단",
    stale: "대화·설정 변경됨",
    sent: "답변에 사용됨",
    cancelled: "취소됨",
};
export function SupportDraftPanel({
    chat,
    messages,
    workspaceId,
    hasDraft,
    onUse,
    onMode,
}: {
    chat: Conversation;
    messages: ChatMessage[];
    workspaceId?: number;
    hasDraft: boolean;
    onUse: (answer: string, id: string) => void;
    onMode: (state: "auto" | "human") => Promise<unknown>;
}) {
    const [opened, setOpened] = useState(false),
        [chosen, setChosen] = useState<string | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const pages = useSupportJobs(chat.id, opened),
        rows =
            pages.data
                ?.flatMap((p) => p.rows)
                .filter(
                    (r, i, all) => all.findIndex((a) => a.id === r.id) === i,
                ) ?? [],
        selected = chosen ?? rows[0]?.id;
    const detail = useSWR<SupportJobDetail>(
        opened && selected
            ? `/api/inbox/conversations/${chat.id}/ai/${selected}`
            : null,
        supportRequest,
        { refreshInterval: opened ? 3000 : 0 },
    );
    const pending = useRef<{ source: number; id: string } | null>(null),
        source = messages.filter((m) => m.kind === "customer").at(-1)?.id ?? 0;
    async function generate() {
        if (busy) return;
        setBusy(true);
        setError("");
        if (pending.current?.source !== source)
            pending.current = { source, id: crypto.randomUUID() };
        try {
            const result = await supportWrite<{ jobId: string }>(
                `/api/inbox/conversations/${chat.id}/ai`,
                { clientId: pending.current.id },
            );
            setChosen(result.jobId);
            pending.current = null;
            await pages.mutate();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const job =
        selected && detail.data?.job?.id === selected
            ? detail.data.job
            : undefined;
    const provenance = job
        ? supportJobProvenance(
              job,
              chat.id,
              rows.find((row) => row.id === job.id),
          )
        : "unknown";
    const readOnly = provenance !== "current";
    return (
        <div className="mx-4 space-y-2 text-xs">
            {chat.aiState === "human" && chat.aiHandoffReason && (
                <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                    사람 응대 · {chat.aiHandoffReason}
                </p>
            )}
            <details
                onToggle={(e) => setOpened(e.currentTarget.open)}
                className="rounded-xl border bg-muted/20 p-3"
            >
                <summary className="cursor-pointer font-semibold">
                    AI 답변 도우미
                </summary>
                <div className="mt-3 max-h-80 space-y-3 overflow-auto">
                    <p className="text-muted-foreground">
                        현재 상담의 승인된 지식으로 초안을 만들고 인용 근거를
                        다시 검토합니다. 현재 초안은 입력창에서 확인하고
                        전송하세요. 병합 전 상담 기록은 확인용으로만 볼 수
                        있습니다.
                    </p>
                    <p className="font-medium">현재 상담 작업</p>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={busy || !source || chat.status !== "open"}
                            className="rounded-lg border bg-background px-3 py-2 disabled:opacity-40"
                            onClick={() => void generate()}
                        >
                            {busy
                                ? "생성·근거 검토 중…"
                                : pending.current
                                  ? "현재 상담의 이전 생성 결과 확인"
                                  : "현재 상담 초안 생성"}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            className="rounded-lg border px-3 py-2"
                            onClick={() =>
                                void onMode(
                                    chat.aiState === "human" ? "auto" : "human",
                                ).catch((e) => toast.error(e.message))
                            }
                        >
                            {chat.aiState === "human"
                                ? "현재 상담 AI 자동 응대 재개 허용"
                                : "현재 상담 사람이 응대하기"}
                        </button>
                        <a
                            className="py-2 text-[#635BFF]"
                            target="_blank"
                            rel="noreferrer"
                            href={`/customer-ai?workspaceId=${workspaceId ?? ""}`}
                        >
                            지식·자동 응대 설정 ↗
                        </a>
                    </div>
                    {(error || pages.error || detail.error) && (
                        <p role="alert" className="text-red-600">
                            {error ||
                                pages.error?.message ||
                                detail.error?.message}
                            <button
                                type="button"
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
                    {!!rows.length && (
                        <select
                            aria-label="AI 생성 기록"
                            className="w-full rounded-lg border bg-background p-2"
                            value={selected ?? ""}
                            onChange={(e) => setChosen(e.target.value)}
                        >
                            {rows.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {
                                        supportProvenanceNames[
                                            supportJobProvenance(r, chat.id)
                                        ]
                                    }{" "}
                                    · {supportJobCreatedAt(r.createdAt)} ·{" "}
                                    {supportStateNames[r.state] ?? r.state}
                                </option>
                            ))}
                        </select>
                    )}
                    {(pages.isLoading || (detail.isLoading && selected)) && (
                        <p role="status" className="text-muted-foreground">
                            {pages.isLoading
                                ? "생성 기록을 불러오는 중…"
                                : "선택한 생성 기록을 불러오는 중…"}
                        </p>
                    )}
                    {job && (
                        <article
                            aria-label="AI 답변 초안"
                            className="space-y-2 rounded-lg border bg-background p-3"
                        >
                            <strong>
                                {supportProvenanceNames[provenance]} ·{" "}
                                {supportStateNames[job.state] ?? job.state}
                            </strong>
                            <p className="text-muted-foreground">
                                {provenance === "merged"
                                    ? "원본 생성 시각"
                                    : "생성 시각"}{" "}
                                <time dateTime={job.createdAt}>
                                    {supportJobCreatedAt(job.createdAt)}
                                </time>
                            </p>
                            {readOnly && (
                                <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                                    {provenance === "merged"
                                        ? "병합 전 상담에서 생성한 기록입니다. 당시 문구와 근거만 확인할 수 있으며, 현재 답변에 넣거나 생성 작업을 취소할 수 없습니다. 새 초안은 위의 현재 상담 작업에서 생성해주세요."
                                        : "이 기록이 현재 상담의 초안인지 확인할 수 없어 읽기 전용으로 표시합니다. 다시 불러온 뒤 출처를 확인해주세요."}
                                </p>
                            )}
                            {provenance === "merged" &&
                                job.originConversationId && (
                                <details className="text-muted-foreground">
                                    <summary className="cursor-pointer">
                                        원본 상담 확인 정보
                                    </summary>
                                    <p className="mt-1 break-all">
                                        원본 상담 ID:{" "}
                                        <code>{job.originConversationId}</code>
                                    </p>
                                </details>
                            )}
                            {job.reason && (
                                <p className="text-amber-800">{job.reason}</p>
                            )}
                            {job.answer && (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                    {job.answer}
                                </p>
                            )}
                            {!readOnly &&
                                job.state === "ready" &&
                                !detail.data?.usable && (
                                <p role="alert" className="text-amber-800">
                                    근거 또는 대화가 변경되었습니다. 최신 초안을
                                    생성해주세요.
                                </p>
                            )}
                            {!readOnly && job.state === "ready" && (
                                <button
                                    type="button"
                                    disabled={!detail.data?.usable}
                                    className="rounded-lg bg-[#635BFF] px-3 py-2 text-white disabled:opacity-40"
                                    onClick={() => {
                                        if (!readOnly && detail.data?.usable)
                                            onUse(job.answer!, job.id);
                                    }}
                                >
                                    {hasDraft
                                        ? "작성 중인 답변 뒤에 추가"
                                        : "답변 초안에 넣기"}
                                </button>
                            )}
                            {!!job.citations.length && (
                                <details>
                                    <summary className="cursor-pointer">
                                        사용한 근거 {job.citations.length}개
                                    </summary>
                                    {job.citations.map((c, index) => (
                                        <blockquote
                                            key={index}
                                            className="my-2 border-l-2 pl-3"
                                        >
                                            <p className="whitespace-pre-wrap">
                                                {c.quote}
                                            </p>
                                            <a
                                                href={c.sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="block break-all text-[#635BFF]"
                                            >
                                                근거 문서 ↗
                                            </a>
                                        </blockquote>
                                    ))}
                                </details>
                            )}
                            {!!detail.data?.calls.length && (
                                <p className="text-muted-foreground">
                                    AI 호출 {detail.data.calls.length}회 · 사용
                                    토큰{" "}
                                    {detail.data.calls.some(
                                        (c) =>
                                            c.promptTokens === null ||
                                            c.completionTokens === null,
                                    )
                                        ? "일부 확인 중"
                                        : detail.data.calls
                                              .reduce(
                                                  (n, c) =>
                                                      n +
                                                      (c.promptTokens ?? 0) +
                                                      (c.completionTokens ?? 0),
                                                  0,
                                              )
                                              .toLocaleString()}{" "}
                                    · 지식 v{job.knowledgeVersionId ?? "없음"}
                                </p>
                            )}
                            {!readOnly &&
                                ["queued", "generating", "ready"].includes(
                                    job.state,
                                ) && (
                                <button
                                    type="button"
                                    className="text-muted-foreground underline"
                                    onClick={async () => {
                                        if (readOnly) return;
                                        try {
                                            await supportWrite(
                                                `/api/inbox/conversations/${chat.id}/ai/${job.id}`,
                                                { action: "cancel" },
                                            );
                                            await Promise.all([
                                                pages.mutate(),
                                                detail.mutate(),
                                            ]);
                                        } catch (e) {
                                            toast.error((e as Error).message);
                                        }
                                    }}
                                >
                                    이 생성 취소
                                </button>
                            )}
                        </article>
                    )}
                    {!pages.isLoading && !pages.error && !rows.length && (
                        <p className="text-muted-foreground">
                            생성한 초안이 없습니다. 고객 문의가 들어오면
                            수동으로 만들어볼 수 있습니다.
                        </p>
                    )}
                    {pages.data?.at(-1)?.hasMore && (
                        <button
                            type="button"
                            onClick={() => void pages.setSize(pages.size + 1)}
                        >
                            이전 생성 기록 더 보기
                        </button>
                    )}
                </div>
            </details>
        </div>
    );
}
