"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ai-copy/ui/Fields";
import { copyRequest } from "@/components/ai-copy/api/copy";
import type { Assignment, ExperimentAction } from "../types";
interface Outcome {
    id: number;
    source_key: string;
    revision: number;
    event_type: string;
    intent: string | null;
    event_at: string;
    email_reply_id: number | null;
    evidence: string;
    active: boolean;
    recorded_at: string;
    recorded_by_name: string;
}
const intentLabel = (intent: string | null) =>
    ({ interested: "관심 있음", neutral: "중립", rejected: "거절", unknown: "미분류" })[
        intent ?? ""
    ] ?? "—";
const eventLabel = (event: string) =>
    ({
        human_reply: "사람 회신",
        meeting: "상담 일정",
        unsubscribe: "수신거부",
        external_contact: "다른 캠페인 접촉",
    })[event] ?? event;
const localDatetime = (value: string) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
export default function OutcomeEditor({
    assignmentId,
    act,
    pending,
}: {
    assignmentId: number;
    act: ExperimentAction;
    pending: boolean;
}) {
    const { data, error } = useSWR<{
        assignment: Assignment;
        replies: {
            id: number;
            subject: string | null;
            excerpt: string | null;
            received_at: string;
        }[];
        history: Outcome[];
    }>(`/api/email/experiments/assignments/${assignmentId}/outcomes`, copyRequest);
    const [edit, setEdit] = useState<Outcome | null>(null);
    if (error) return <p role="alert">성과 기록을 불러오지 못했습니다.</p>;
    if (!data) return <p>회신과 수정 이력을 불러오는 중입니다.</p>;
    return (
        <section className="space-y-4 rounded-md border p-4">
            <h3 className="font-semibold">{data.assignment.normalized_email} 성과 기록</h3>
            <p className="text-sm text-muted-foreground">
                가격·자료·미팅·도입 문의는 관심 있음, 단순한 감사 인사는 중립으로 구분합니다. 자동
                응답과 반송은 사람 회신으로 집계하지 않습니다. 수정은 새 이력으로 남깁니다.
            </p>
            <OutcomeForm
                key={edit?.id ?? "new"}
                assignmentId={assignmentId}
                replies={data.replies}
                initial={edit}
                act={act}
                pending={pending}
            />
            {edit && (
                <Button variant="outline" onClick={() => setEdit(null)}>
                    새 기록 작성으로 돌아가기
                </Button>
            )}
            <h4 className="text-sm font-medium">수정 이력</h4>
            {!data.history.length ? (
                <p className="text-sm text-muted-foreground">
                    아직 별도로 분류하거나 기록한 성과가 없습니다.
                </p>
            ) : (
                <ul className="space-y-3">
                    {data.history.map((h) => (
                        <li key={h.id} className="space-y-1 rounded-md bg-muted p-3 text-sm">
                            <div>
                                {eventLabel(h.event_type)} · {intentLabel(h.intent)} · 수정{" "}
                                {h.revision} · {h.active ? "유효" : "철회"}
                            </div>
                            <p>{h.evidence}</p>
                            <p className="text-xs text-muted-foreground">
                                발생 {new Date(h.event_at).toLocaleString("ko-KR")} · 기록{" "}
                                {new Date(h.recorded_at).toLocaleString("ko-KR")} ·{" "}
                                {h.recorded_by_name}
                            </p>
                            <Button size="sm" variant="outline" onClick={() => setEdit(h)}>
                                새 수정 이력 작성
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
function OutcomeForm({
    assignmentId,
    replies,
    initial,
    act,
    pending,
}: {
    assignmentId: number;
    replies: { id: number; subject: string | null; excerpt: string | null; received_at: string }[];
    initial: Outcome | null;
    act: ExperimentAction;
    pending: boolean;
}) {
    const [replyId, setReplyId] = useState(initial?.email_reply_id ?? 0),
        [eventType, setEventType] = useState(initial?.event_type ?? "human_reply");
    const [sourceKey, setSourceKey] = useState(initial?.source_key ?? ""),
        [intent, setIntent] = useState(initial?.intent ?? "unknown");
    const [eventAt, setEventAt] = useState(initial ? localDatetime(initial.event_at) : ""),
        [evidence, setEvidence] = useState(initial?.evidence ?? ""),
        [active, setActive] = useState(initial?.active ?? true);
    const selectedReply = replies.find((r) => r.id === replyId);
    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                void act(`/api/email/experiments/assignments/${assignmentId}/outcomes`, {
                    sourceKey: replyId ? `reply:${replyId}` : sourceKey,
                    eventType,
                    intent: eventType === "human_reply" ? intent : null,
                    eventAt: selectedReply
                        ? new Date(selectedReply.received_at).toISOString()
                        : new Date(eventAt).toISOString(),
                    emailReplyId: eventType === "human_reply" && replyId ? replyId : null,
                    evidence,
                    active,
                });
            }}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="기록 종류">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={eventType}
                            onChange={(e) => {
                                setEventType(e.target.value);
                                setReplyId(0);
                            }}
                        >
                            {["human_reply", "meeting", "unsubscribe", "external_contact"].map(
                                (kind) => (
                                    <option key={kind} value={kind}>
                                        {eventLabel(kind)}
                                    </option>
                                ),
                            )}
                        </select>
                    )}
                </Field>
                {eventType === "human_reply" && (
                    <>
                        <Field label="연결된 사람 회신">
                            {(id) => (
                                <select
                                    id={id}
                                    className={controlClass}
                                    value={replyId}
                                    onChange={(e) => setReplyId(Number(e.target.value))}
                                >
                                    <option value={0}>담당자가 확인한 회신을 수동 기록</option>
                                    {replies.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            #{r.id} {r.subject ?? "제목 없음"}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </Field>
                        <Field label="회신의 관심 여부">
                            {(id) => (
                                <select
                                    id={id}
                                    className={controlClass}
                                    value={intent}
                                    onChange={(e) => setIntent(e.target.value)}
                                >
                                    {["interested", "neutral", "rejected", "unknown"].map((i) => (
                                        <option key={i} value={i}>
                                            {intentLabel(i)}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </Field>
                    </>
                )}
                {!selectedReply && (
                    <>
                        <Field
                            label="원본 기록 식별자"
                            help="같은 회신을 중복 기록하지 않도록 메일 번호나 상담 기록 번호를 적습니다."
                        >
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    required
                                    value={sourceKey}
                                    onChange={(e) => setSourceKey(e.target.value)}
                                />
                            )}
                        </Field>
                        <Field label="실제 발생 시각">
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="datetime-local"
                                    required
                                    value={eventAt}
                                    onChange={(e) => setEventAt(e.target.value)}
                                />
                            )}
                        </Field>
                    </>
                )}
            </div>
            {selectedReply && (
                <div className="rounded-md bg-muted p-3 text-sm">
                    <p>{selectedReply.excerpt ?? "발췌 없음"}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {new Date(selectedReply.received_at).toLocaleString("ko-KR")}
                    </p>
                </div>
            )}
            <Field label="확인 내용 또는 수정 이유">
                {(id) => (
                    <textarea
                        id={id}
                        className={controlClass}
                        minLength={10}
                        required
                        rows={3}
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                    />
                )}
            </Field>
            <label className="flex items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                />
                이 기록이 유효합니다. 해제하면 이전 기록을 철회한 이력을 남깁니다.
            </label>
            <Button disabled={pending} type="submit">
                {initial ? "수정 이력 추가" : "확인한 성과 기록"}
            </Button>
        </form>
    );
}
