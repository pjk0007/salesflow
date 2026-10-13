"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copyRequest } from "../api/copy";
import type {
    CopyCatalog,
    CopyPurpose,
    EvaluationReport,
    EvaluationRow,
    KnowledgeVersion,
} from "../types";
import { controlClass, Field, purposeLabel, stateLabel } from "./Fields";
type Action = <T>(url: string, body: unknown) => Promise<T | undefined>;
const percent = (n: number | null | undefined) =>
    n == null ? "미측정" : `${(n * 100).toFixed(1)}%`;
const seconds = (n: number | null | undefined) =>
    n == null ? "미측정" : `${(n / 1000).toFixed(1)}초`;
export function EvaluationManager({
    catalog,
    knowledge,
    act,
    pending,
}: {
    catalog: CopyCatalog;
    knowledge: KnowledgeVersion[];
    act: Action;
    pending: boolean;
}) {
    const [purpose, setPurpose] = useState<CopyPurpose>("visit_ack"),
        [selected, setSelected] = useState<number | null>(null),
        [cursor, setCursor] = useState(0);
    const [pairs, setPairs] = useState(
        [0, 1].map(() => ({
            workspaceId: 0,
            baselinePolicyId: 0,
            candidatePolicyId: 0,
            knowledgeVersionId: 0,
        })),
    );
    const { data, error, isLoading } = useSWR<{ runs: EvaluationRow[]; nextCursor: number | null }>(
        `/api/ai/copy-evaluations?cursor=${cursor}`,
        copyRequest,
        { refreshInterval: 15000 },
    );
    const update = (index: number, values: Partial<(typeof pairs)[number]>) =>
        setPairs((items) => items.map((p, i) => (i === index ? { ...p, ...values } : p)));
    return (
        <div className="space-y-6">
            <details className="rounded-md border p-4">
                <summary className="cursor-pointer font-medium">새 비교 평가 만들기</summary>
                <form
                    className="mt-4 space-y-4"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        const run = await act<{ id: number }>("/api/ai/copy-evaluations", {
                            purpose,
                            pairs,
                        });
                        if (run) setSelected(run.id);
                    }}
                >
                    <Field label="평가할 메일">
                        {(id) => (
                            <select
                                id={id}
                                className={controlClass}
                                value={purpose}
                                onChange={(e) => setPurpose(e.target.value as CopyPurpose)}
                            >
                                {["initial_email", "visit_ack"].map((p) => (
                                    <option key={p} value={p}>
                                        {purposeLabel(p)}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>
                    {pairs.map((pair, index) => (
                        <fieldset
                            key={index}
                            className="grid gap-3 rounded-md border p-4 sm:grid-cols-2"
                        >
                            <legend className="px-1 text-sm">사업 {index + 1}</legend>
                            <Field label="사업">
                                {(id) => (
                                    <select
                                        id={id}
                                        required
                                        className={controlClass}
                                        value={pair.workspaceId || ""}
                                        onChange={(e) =>
                                            update(index, {
                                                workspaceId: Number(e.target.value),
                                                baselinePolicyId: 0,
                                                candidatePolicyId: 0,
                                                knowledgeVersionId: 0,
                                            })
                                        }
                                    >
                                        <option value="">선택</option>
                                        {catalog.workspaces.map((w) => (
                                            <option key={w.id} value={w.id}>
                                                {w.name}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </Field>
                            <Field label="승인된 지식">
                                {(id) => (
                                    <select
                                        id={id}
                                        required
                                        className={controlClass}
                                        value={pair.knowledgeVersionId || ""}
                                        onChange={(e) =>
                                            update(index, {
                                                knowledgeVersionId: Number(e.target.value),
                                            })
                                        }
                                    >
                                        <option value="">선택</option>
                                        {knowledge
                                            .filter(
                                                (k) =>
                                                    k.workspace_id === pair.workspaceId &&
                                                    k.state === "approved",
                                            )
                                            .map((k) => (
                                                <option key={k.id} value={k.id}>
                                                    {k.name} · #{k.id}
                                                </option>
                                            ))}
                                    </select>
                                )}
                            </Field>
                            {(["baselinePolicyId", "candidatePolicyId"] as const).map((key) => (
                                <Field
                                    key={key}
                                    label={
                                        key === "baselinePolicyId"
                                            ? "기준 작성 지침"
                                            : "후보 작성 지침"
                                    }
                                >
                                    {(id) => (
                                        <select
                                            id={id}
                                            required
                                            className={controlClass}
                                            value={pair[key] || ""}
                                            onChange={(e) =>
                                                update(index, { [key]: Number(e.target.value) })
                                            }
                                        >
                                            <option value="">선택</option>
                                            {catalog.versions
                                                .filter(
                                                    (p) =>
                                                        p.workspace_id === pair.workspaceId &&
                                                        p.purpose === purpose &&
                                                        !["blocked", "retired"].includes(p.state),
                                                )
                                                .map((p) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name} · #{p.id}
                                                    </option>
                                                ))}
                                        </select>
                                    )}
                                </Field>
                            ))}
                        </fieldset>
                    ))}
                    <p className="text-sm text-muted-foreground">
                        두 사업 × 20개 가상 맥락 × 5회 × 두 버전으로 400건을 생성합니다. 실제
                        고객에게 발송하지 않으며 AI 사용량은 차감됩니다. 이어서 80건을 두 사람이
                        독립 평가합니다.
                    </p>
                    <Button disabled={pending} type="submit">
                        400건 가상 평가 시작
                    </Button>
                </form>
            </details>
            {isLoading ? (
                <p>평가 목록을 불러오는 중입니다.</p>
            ) : error ? (
                <p role="alert">평가 목록을 불러오지 못했습니다.</p>
            ) : !data?.runs.length ? (
                <p className="text-muted-foreground">아직 생성한 평가가 없습니다.</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {data.runs.map((run) => (
                        <Button
                            key={run.id}
                            variant={selected === run.id ? "secondary" : "outline"}
                            onClick={() => setSelected(run.id)}
                        >
                            #{run.id} {purposeLabel(run.purpose)} · {stateLabel(run.state)}
                        </Button>
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                {cursor > 0 && (
                    <Button variant="ghost" onClick={() => setCursor(0)}>
                        최근 평가
                    </Button>
                )}
                {data?.nextCursor && (
                    <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>
                        이전 평가
                    </Button>
                )}
            </div>
            {selected && <EvaluationDetail id={selected} act={act} pending={pending} />}
        </div>
    );
}
function EvaluationDetail({ id, act, pending }: { id: number; act: Action; pending: boolean }) {
    const detail = useSWR<{ run: EvaluationRow; report: EvaluationReport }>(
        `/api/ai/copy-evaluations/${id}`,
        copyRequest,
        { refreshInterval: 15000 },
    );
    const benchmark = useSWR<{
        id: number;
        state: string;
        finishedSamples: number;
        totalSamples: number;
    } | null>(`/api/ai/copy-evaluations/${id}/benchmark`, copyRequest, { refreshInterval: 15000 });
    const [region, setRegion] = useState("CloudType sel5"),
        [reviewsOpen, setReviewsOpen] = useState(false);
    if (detail.error) return <p role="alert">평가 상세를 불러오지 못했습니다.</p>;
    if (!detail.data) return <p>평가 결과를 불러오는 중입니다.</p>;
    const { report, run } = detail.data;
    return (
        <section className="space-y-4 rounded-md border p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">
                    평가 #{id} <Badge variant="secondary">{stateLabel(run.state)}</Badge>
                </h3>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={
                            pending ||
                            (!["pending", "running"].includes(run.state) &&
                                benchmark.data?.state !== "running")
                        }
                        onClick={() =>
                            void act(`/api/ai/copy-evaluations/${id}`, { action: "process" })
                        }
                    >
                        진행 확인
                    </Button>
                    {["pending", "running", "review"].includes(run.state) && (
                        <Button
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                                void act(`/api/ai/copy-evaluations/${id}`, { action: "cancel" })
                            }
                        >
                            평가 취소
                        </Button>
                    )}
                </div>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
                <p>자동 평가 유효 {report.validCases}/400건</p>
                <p>이중 사람 평가 {report.reviewedCases}/80건</p>
                <p>자연스러움 평균 {report.naturalness.average?.toFixed(2) ?? "미평가"}</p>
                <p>첫 생성 성공률 {percent(report.firstAttemptSuccess)}</p>
                <p>95% 생성 시간 {seconds(report.p95Ms)}</p>
                <p>부하 중 95% 생성 시간 {seconds(report.loadP95Ms)}</p>
                <p>30분 내 준비 {percent(report.readyWithin30Minutes)}</p>
                <p>
                    기준안 평균 비용{" "}
                    {report.baselineCostKrw == null
                        ? "확인 필요"
                        : `${report.baselineCostKrw.toFixed(3)}원`}
                </p>
                <p>
                    후보안 평균 비용{" "}
                    {report.candidateCostKrw == null
                        ? "확인 필요"
                        : `${report.candidateCostKrw.toFixed(3)}원`}
                </p>
            </div>
            <p className="text-sm text-muted-foreground">
                99% 생성 시간 {seconds(report.combinedP99)} ·{" "}
                {report.combinedP99Provisional ? "1,000건 전 참고값" : "1,000건 이상 측정"}. 현재{" "}
                {report.totalLatencySamples}건이며 시간 초과 시도도 포함합니다.
            </p>
            {report.blocks.length > 0 ? (
                <div className="rounded-md bg-muted p-4">
                    <p className="mb-2 font-medium">승인 전 확인할 항목</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                        {report.blocks.map((b) => (
                            <li key={b}>{b}</li>
                        ))}
                    </ul>
                </div>
            ) : (
                <p className="text-sm font-medium">
                    설정한 평가 기준을 통과했습니다. 작성 지침 화면에서 승인할 수 있습니다.
                </p>
            )}
            <details className="rounded-md border p-4">
                <summary className="cursor-pointer text-sm font-medium">부하 성능 측정</summary>
                <div className="mt-3 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        분당 6건을 30분 동안 준비하고 30건을 한 번에 추가하는 조건을 세 번
                        측정합니다. 총 630회 추가 호출과 약 105분 이상이 필요합니다. 측정 서버의
                        CPU·메모리·모델·입력 길이를 함께 기록합니다.
                    </p>
                    {benchmark.data ? (
                        <p>
                            {stateLabel(benchmark.data.state)} · {benchmark.data.finishedSamples}/
                            {benchmark.data.totalSamples}건
                        </p>
                    ) : (
                        <p>아직 측정하지 않았습니다.</p>
                    )}
                    <Field label="측정 서버 리전">
                        {(fieldId) => (
                            <input
                                id={fieldId}
                                className={controlClass}
                                value={region}
                                onChange={(e) => setRegion(e.target.value)}
                            />
                        )}
                    </Field>
                    <div className="flex gap-2">
                        <Button
                            disabled={
                                pending ||
                                run.state !== "review" ||
                                benchmark.data?.state === "running"
                            }
                            onClick={() =>
                                void act(`/api/ai/copy-evaluations/${id}/benchmark`, {
                                    action: "start",
                                    region,
                                })
                            }
                        >
                            가상 부하 측정 시작
                        </Button>
                        {benchmark.data?.state === "running" && (
                            <Button
                                variant="outline"
                                disabled={pending}
                                onClick={() =>
                                    void act(`/api/ai/copy-evaluations/${id}/benchmark`, {
                                        action: "cancel",
                                    })
                                }
                            >
                                측정 중단
                            </Button>
                        )}
                    </div>
                </div>
            </details>
            {run.state === "review" && (
                <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                        void act(`/api/ai/copy-evaluations/${id}`, { action: "resume_quota" })
                    }
                >
                    사용량 한도 확인 후 평가 재개
                </Button>
            )}
            <Button variant="outline" onClick={() => setReviewsOpen((v) => !v)}>
                {reviewsOpen ? "문구 평가 닫기" : "문구를 보고 독립 평가하기"}
            </Button>
            {reviewsOpen && <HumanReviewPanel key={id} runId={id} act={act} pending={pending} />}
        </section>
    );
}
interface BlindCase {
    id: number;
    blind_label: string;
    case_key: string;
    knowledge_snapshot: { businessName: string; claims: { text: string; sourceUrl: string }[] };
    context_data: string;
    output: { subject: string; htmlBody: string };
    reviewed_at: string | null;
    naturalness: number | null;
    factuality: number | null;
    purpose_fit: number | null;
    critical_error: boolean | null;
    review_count: number;
    disagreement: boolean;
    resolved: boolean;
    other_reviews?: { reviewerName: string; naturalness: number; factuality: number; purposeFit: number; criticalError: boolean; notes: string }[];
}
function HumanReviewPanel({
    runId,
    act,
    pending,
}: {
    runId: number;
    act: Action;
    pending: boolean;
}) {
    const { data, error } = useSWR<{ cases: BlindCase[] }>(
        `/api/ai/copy-evaluations/${runId}/reviews`,
        copyRequest,
    );
    const [page, setPage] = useState(0);
    if (error) return <p role="alert">평가할 문구를 불러오지 못했습니다.</p>;
    if (!data) return <p>평가 문구를 불러오는 중입니다.</p>;
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                어느 버전인지 가리고 문구를 제시합니다. 자연스러움·사실성·메일 목적 적합성을 각각
                1~5점으로 평가해 주세요. 제출한 점수는 보존합니다.
            </p>
            {!data.cases.length && <p>자동 생성이 끝난 평가 문구가 아직 없습니다.</p>}
            {data.cases.slice(page * 10, page * 10 + 10).map((item) => (
                <HumanReviewItem
                    key={item.id}
                    item={item}
                    runId={runId}
                    act={act}
                    pending={pending}
                />
            ))}
            <div className="flex gap-3">
                <Button
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                >
                    앞 문구
                </Button>
                <span className="self-center text-sm">
                    {page + 1} / {Math.max(1, Math.ceil(data.cases.length / 10))}
                </span>
                <Button
                    variant="outline"
                    disabled={(page + 1) * 10 >= data.cases.length}
                    onClick={() => setPage((p) => p + 1)}
                >
                    다음 문구
                </Button>
            </div>
        </div>
    );
}
function HumanReviewItem({
    item,
    runId,
    act,
    pending,
}: {
    item: BlindCase;
    runId: number;
    act: Action;
    pending: boolean;
}) {
    const [scores, setScores] = useState({ naturalness: "", factuality: "", purposeFit: "" }),
        [criticalError, setCriticalError] = useState(false),
        [notes, setNotes] = useState("");
    const resolve = !!item.reviewed_at && item.disagreement && !item.resolved;
    return (
        <article className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">문구 {item.blind_label.slice(0, 8)}</p>
            <details className="text-sm">
                <summary className="cursor-pointer">가상 맥락과 지식 근거 보기</summary>
                <p className="mt-2">{JSON.parse(item.context_data).scenario}</p>
                <p>{item.knowledge_snapshot.businessName}</p>
                <ul className="list-disc pl-5">
                    {item.knowledge_snapshot.claims.map((c, i) => (
                        <li key={i}>
                            {c.text}{" "}
                            <a
                                className="underline"
                                href={c.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                근거
                            </a>
                        </li>
                    ))}
                </ul>
            </details>
            <p className="text-sm">{item.output.subject}</p>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">
                {item.output.htmlBody
                    .replace(/<[^>]*>/g, "\n")
                    .replace(/\n+/g, "\n")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .trim()}
            </pre>
            {item.reviewed_at && (
                <p className="text-sm text-muted-foreground">
                    내 평가 제출 완료 · 자연스러움 {item.naturalness} · 사실성 {item.factuality} ·
                    목적 적합성 {item.purpose_fit}
                </p>
            )}
            {resolve && (
                <p className="text-sm font-medium">
                    평가 차이가 있어 합의 결과와 근거를 기록해야 합니다.
                </p>
            )}
            {item.reviewed_at && item.other_reviews?.map((review, index) => (
                <div key={index} className="rounded-md bg-muted p-3 text-sm">
                    <p>{review.reviewerName} · 자연스러움 {review.naturalness} · 사실성 {review.factuality} · 목적 적합성 {review.purposeFit}{review.criticalError && " · 중대한 문제 표시"}</p>
                    <p>{review.notes || "메모 없음"}</p>
                </div>
            ))}
            {(!item.reviewed_at || resolve) && (
                <form
                    className="space-y-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void act(`/api/ai/copy-evaluations/${runId}/reviews`, {
                            caseId: item.id,
                            ...Object.fromEntries(
                                Object.entries(scores).map(([k, v]) => [k, Number(v)]),
                            ),
                            criticalError,
                            notes,
                            resolve,
                        });
                    }}
                >
                    <div className="grid gap-3 sm:grid-cols-3">
                        {(["naturalness", "factuality", "purposeFit"] as const).map((key) => (
                            <Field
                                key={key}
                                label={
                                    {
                                        naturalness: "자연스러움",
                                        factuality: "사실성",
                                        purposeFit: "목적 적합성",
                                    }[key]
                                }
                            >
                                {(id) => (
                                    <select
                                        id={id}
                                        className={controlClass}
                                        required
                                        value={scores[key]}
                                        onChange={(e) =>
                                            setScores((s) => ({ ...s, [key]: e.target.value }))
                                        }
                                    >
                                        <option value="">점수 선택</option>
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <option key={n} value={n}>
                                                {n}점
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </Field>
                        ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={criticalError}
                            onChange={(e) => setCriticalError(e.target.checked)}
                        />
                        근거 없는 약속·사실 오류·방문 관찰 노출 등 중대한 문제가 있습니다
                    </label>
                    <Field label={resolve ? "합의 근거" : "평가 메모"}>
                        {(id) => (
                            <textarea
                                id={id}
                                className={controlClass}
                                value={notes}
                                required={resolve}
                                minLength={resolve ? 10 : undefined}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        )}
                    </Field>
                    <Button disabled={pending} type="submit">
                        {resolve ? "합의 결과 저장" : "내 독립 평가 제출"}
                    </Button>
                </form>
            )}
        </article>
    );
}
