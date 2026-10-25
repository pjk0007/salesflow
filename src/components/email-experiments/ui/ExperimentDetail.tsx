"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { controlClass, Field, stateLabel as copyStateLabel } from "@/components/ai-copy/ui/Fields";
import { copyRequest } from "@/components/ai-copy/api/copy";
import type {
    Assignment,
    ArmSummary,
    ExperimentAction,
    ExperimentPreview,
    ExperimentResults,
} from "../types";
import OutcomeEditor from "./OutcomeEditor";
import { experimentStateLabel } from "@/lib/email-experiments/state-labels";
// 서버의 판단 보류 사유와 같은 맵 (UX-158)
export { experimentStateLabel };
const percent = (value: number | null, available = true) =>
    !available
        ? "수집 확인 필요"
        : value === null
          ? "아직 관찰 전"
          : `${(value * 100).toFixed(2)}%`;
const point = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%p`;
export default function ExperimentDetail({
    id,
    act,
    pending,
}: {
    id: number;
    act: ExperimentAction;
    pending: boolean;
}) {
    const { data, error } = useSWR<ExperimentResults>(`/api/email/experiments/${id}`, copyRequest, {
        refreshInterval: 15000,
    });
    const [action, setAction] = useState<string | null>(null),
        [reason, setReason] = useState(""),
        [pendingMode, setPendingMode] = useState("hold");
    if (error) return <p role="alert">실험 결과를 불러오지 못했습니다.</p>;
    if (!data) return <p>실험 결과를 불러오는 중입니다.</p>;
    const { experiment, report, collection } = data;
    const metricRows: { label: string; key: keyof ArmSummary }[] = [
        { label: "배정 고객", key: "assigned" },
        { label: "14일 관찰 완료 고객", key: "matured" },
        { label: "생성 완료 고객", key: "generated" },
        { label: "발송 접수 고객", key: "sent" },
        { label: "사람 회신 고객", key: "humanReplies" },
        { label: "긍정 회신 고객", key: "positive" },
        { label: "미분류 회신 건", key: "unclassifiedReplies" },
        { label: "수신거부 고객", key: "unsubscribed" },
    ];
    return (
        <section className="space-y-5 rounded-md border p-5">
            <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">
                    {experiment.name} · #{id}
                </h2>
                <Badge variant="secondary">{experimentStateLabel(experiment.state)}</Badge>
                <Badge variant="outline">{report.label}</Badge>
            </div>
            <p className="text-sm">
                규칙 #{experiment.rule_id} · A #{experiment.config.policyAId} / B #
                {experiment.config.policyBId} · 지식 #{experiment.config.knowledgeVersionId} · 제목
                ‘{experiment.config.subject}’
            </p>
            <p className="text-sm text-muted-foreground">{experiment.config.hypothesis}</p>
            <p className="text-sm text-muted-foreground">
                {experiment.config.analysisUnit === "recipient"
                    ? "고객 이메일 기준으로 A/B를 비교합니다. 회사 확인이나 등급 등록은 필요 없습니다."
                    : "이전에 만든 실험은 당시 회사 단위 집계 기준을 유지합니다. 새 실험은 고객 이메일 기준으로 비교합니다."}
            </p>
            {["draft", "evaluated"].includes(experiment.state) && (
                <ExperimentStart id={id} act={act} pending={pending} />
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr>
                            {["비교 항목", "A 기준", "B 후보"].map((s) => (
                                <th key={s} className="border-b p-3">
                                    {s}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {metricRows.map((row) => (
                            <tr key={row.key}>
                                <td className="border-b p-3">{row.label}</td>
                                <td className="border-b p-3">
                                    {String(report.A[row.key] ?? "미관찰")}
                                </td>
                                <td className="border-b p-3">
                                    {String(report.B[row.key] ?? "미관찰")}
                                </td>
                            </tr>
                        ))}
                        <tr>
                            <td className="border-b p-3 font-medium">긍정 회신율 전체 배정 기준</td>
                            <td className="border-b p-3">
                                {percent(report.A.positiveRate, collection.available)}
                            </td>
                            <td className="border-b p-3">
                                {percent(report.B.positiveRate, collection.available)}
                            </td>
                        </tr>
                        <tr>
                            <td className="border-b p-3">회신 의도 분류율</td>
                            <td className="border-b p-3">
                                {percent(report.A.classificationCoverage, collection.available)}
                            </td>
                            <td className="border-b p-3">
                                {percent(report.B.classificationCoverage, collection.available)}
                            </td>
                        </tr>
                        <tr>
                            <td className="border-b p-3">AI 생성 비용 실패·재시도 포함</td>
                            {["A", "B"].map((arm) => {
                                const cost = data.costs.find((c) => c.arm === arm);
                                return (
                                    <td key={arm} className="border-b p-3">
                                        {cost?.cost_known && cost.cost_krw !== null
                                            ? `${Number(cost.cost_krw).toFixed(2)}원`
                                            : "확인 필요"}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
            <p className="text-sm text-muted-foreground">
                {data.metricExplanation} 집계 기준 {new Date(report.asOf).toLocaleString("ko-KR")}.{" "}
                {collection.method === "manual"
                    ? "수동 확인 회신을 사용합니다."
                    : "연결된 사람 회신을 사용합니다."}
            </p>
            {report.effect && collection.available && (
                <div className="rounded-md bg-muted p-4 text-sm">
                    <p>
                        B−A 차이 {point(report.effect.difference)} · 95% 구간{" "}
                        {point(report.effect.low)} ~ {point(report.effect.high)}
                    </p>
                    <p>
                        상대 변화{" "}
                        {report.effect.relativeLift === null
                            ? "A 기준율이 0이어서 계산할 수 없습니다."
                            : `${(report.effect.relativeLift * 100).toFixed(1)}%`}{" "}
                        · 채택 최소 실무 차이 {point(experiment.config.minimumPracticalDifference)}
                    </p>
                </div>
            )}
            {report.blocks.length > 0 && (
                <div className="rounded-md bg-muted p-4">
                    <p className="mb-2 font-medium">결론 전 확인할 항목</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                        {report.blocks.map((b) => (
                            <li key={b}>{b}</li>
                        ))}
                    </ul>
                </div>
            )}
            <details className="rounded-md border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                    보조 집계 보기
                </summary>
                <div className="mt-3 space-y-2 text-sm">
                    <p>
                        실제 발송 후 14일 긍정 회신율: A{" "}
                        {percent(report.A.actualSendPositiveRate, collection.available)} / B{" "}
                        {percent(report.B.actualSendPositiveRate, collection.available)} · 관찰 완료
                        발송 A {report.A.actualSendMatured}명 / B {report.B.actualSendMatured}명
                    </p>
                    {experiment.config.analysisUnit !== "recipient" && (
                        <p>
                            이전 기준의 참고 집계: A {report.exploratory.A.assigned}명 / B{" "}
                            {report.exploratory.B.assigned}명. 기존 비교 표본과 구분합니다.
                        </p>
                    )}
                    <p>
                        30일 상담 일정 수동 기록: A{" "}
                        {report.A.meetings30d ? `${report.A.meetings30d}건` : "기록 확인 필요"} / B{" "}
                        {report.B.meetings30d ? `${report.B.meetings30d}건` : "기록 확인 필요"}.
                        각각 30일 관찰 완료 A {report.A.meetingMatured}명 / B{" "}
                        {report.B.meetingMatured}명 기준입니다.
                    </p>
                    <p>
                        발신 프로필 변경 {data.senderChanges}건 · 배정 비율 검사{" "}
                        {report.srm.checked
                            ? report.srm.suspected
                                ? "이상 의심"
                                : "현재 이상 없음"
                            : "200명 이후 검사"}
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    {[
                                        "집단",
                                        "예정 발신 프로필",
                                        "실제 프로필",
                                        "배정",
                                    ].map((s) => (
                                        <th key={s} className="p-2">
                                            {s}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.senderGroups.map((g, i) => (
                                    <tr key={i}>
                                        {[
                                            g.arm,
                                            g.planned_sender_email ?? g.planned_sender_id,
                                            g.actual_sender_email ?? g.actual_sender_id,
                                            g.assigned,
                                        ].map((v, j) => (
                                            <td key={j} className="border-t p-2">
                                                {String(v ?? "미정")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
            <div className="flex flex-wrap gap-2">
                {["running", "observing", "enrollment_closed"].includes(experiment.state) && (
                    <Button
                        variant="outline"
                        onClick={() => {
                            setAction("pause");
                            setReason("");
                        }}
                    >
                        일시 중지
                    </Button>
                )}
                {experiment.state === "paused" && (
                    <Button
                        variant="outline"
                        onClick={() => {
                            setAction("resume");
                            setReason("");
                        }}
                    >
                        재개
                    </Button>
                )}
                {["running", "paused"].includes(experiment.state) && (
                    <Button
                        variant="outline"
                        onClick={() => {
                            setAction("close_enrollment");
                            setReason("");
                        }}
                    >
                        모집 종료
                    </Button>
                )}
                {experiment.state !== "closed" && (
                    <>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setAction("invalidate");
                                setReason("");
                            }}
                        >
                            실험 무효화
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setAction("close");
                                setReason("");
                            }}
                        >
                            실험 종료
                        </Button>
                    </>
                )}
                {report.canAdopt && ["observing", "decision_ready"].includes(experiment.state) && (
                    <Button
                        disabled={pending}
                        onClick={() => {
                            // 운영 문구가 바뀌고 실험이 닫히므로 다른 상태 변경처럼 확인 단계를 거친다 (UX-230)
                            setAction("adopt");
                            setReason("");
                        }}
                    >
                        B를 새 작업에 채택
                    </Button>
                )}
            </div>
            {action && (
                <form
                    className="space-y-3 rounded-md border p-4"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        const saved = await act(
                            `/api/email/experiments/${id}`,
                            action === "adopt" ? { action } : { action, reason, pendingMode },
                        );
                        if (saved) setAction(null);
                    }}
                >
                    <p className="text-sm">
                        {action === "adopt"
                            ? "B 작성 지침을 이 규칙의 새 AI 첫 메일에 적용하고 실험을 종료합니다. 이미 만든 문구와 보낸 메일은 바뀌지 않습니다. " +
                              "되돌리려면 AI 품질 관리의 연결 이력에서 A 버전을 다시 연결하세요."
                            : action === "pause"
                            ? "새 고객의 실험 준비를 중지합니다. 이미 발송한 메일은 계속 관찰합니다."
                            : action === "invalidate"
                              ? "이 실험의 결과를 채택하지 않으며 미발송 실험 작업을 보류합니다."
                              : action === "close"
                                ? "실험을 종료하고 기록을 보존합니다."
                                : "변경 사유를 이력에 남깁니다."}
                    </p>
                    {["pause", "close"].includes(action) && (
                        <Field label="이미 배정한 미발송 고객">
                            {(fieldId) => (
                                <select
                                    id={fieldId}
                                    className={controlClass}
                                    value={pendingMode}
                                    onChange={(e) => setPendingMode(e.target.value)}
                                >
                                    <option value="hold">
                                        {action === "close" ? "남은 작업 취소" : "준비·전송 보류"}
                                    </option>
                                    <option value="continue">기존 버전으로 계속 준비·전송</option>
                                </select>
                            )}
                        </Field>
                    )}
                    {action !== "adopt" && (
                        <Field label="변경 이유">
                            {(fieldId) => (
                                <textarea
                                    id={fieldId}
                                    required
                                    minLength={10}
                                    className={controlClass}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                />
                            )}
                        </Field>
                    )}
                    <div className="flex gap-2">
                        <Button disabled={pending} type="submit">
                            {action === "adopt" ? "B 채택하고 실험 종료" : "변경 저장"}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setAction(null)}>
                            닫기
                        </Button>
                    </div>
                </form>
            )}
            <Assignments id={id} act={act} pending={pending} />
        </section>
    );
}
function ExperimentStart({
    id,
    act,
    pending,
}: {
    id: number;
    act: ExperimentAction;
    pending: boolean;
}) {
    const { data, error, mutate } = useSWR<ExperimentPreview>(
        `/api/email/experiments/${id}/preview`,
        copyRequest,
    );
    const [acknowledged, setAcknowledged] = useState(false);
    if (error) return <p role="alert">시작 전 대상 미리보기를 불러오지 못했습니다.</p>;
    if (!data) return <p>대상과 수집 기간을 계산하는 중입니다.</p>;
    return (
        <div className="space-y-3 rounded-md bg-muted p-4">
            <h3 className="font-medium">시작 전 미리보기</h3>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
                <p>적재 대기열 {data.counts.queuedRecords}건</p>
                <p>비교 대상 고객 {data.counts.primary}명</p>
                <p>이메일 중복 제외 {data.counts.duplicateEmail}명</p>
                {data.analysisUnit === "legacy_company" && (
                    <>
                        <p>이전 기준 참고 대상 {data.counts.exploratory}명</p>
                        <p>기존 회사 중복 제외 {data.counts.companyDuplicate}명</p>
                    </>
                )}
                <p>내부 계정 제외 {data.counts.internal}명</p>
                <p>기존 접촉 제외 {data.counts.alreadyContacted}명</p>
                <p>기존 준비 본문 제외 {data.counts.alreadyPrepared}건</p>
                <p>필요 표본 각 {data.requiredPerArm.toLocaleString()}명</p>
                <p>
                    예상 최소 모집{" "}
                    {data.estimatedMinimumEnrollmentDays === null
                        ? "계산 불가"
                        : `${data.estimatedMinimumEnrollmentDays}일`}
                </p>
            </div>
            {data.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-sm">
                    {data.warnings.map((w) => (
                        <li key={w}>{w}</li>
                    ))}
                </ul>
            )}
            <p className="text-xs text-muted-foreground">{data.explanation}</p>
            <details className="text-sm">
                <summary className="cursor-pointer">42일 발신 한도 예상</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                    {data.capacitySchedule.map((d, i) => (
                        <span key={i} className="rounded border bg-background p-2">
                            {d.date || `${i + 1}일째`}:{" "}
                            {d.capacity === null ? "한도 없음" : `${d.capacity}건`}
                        </span>
                    ))}
                </div>
            </details>
            {data.warnings.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    표본과 수집 기간의 제약을 확인했습니다. 부족한 표본으로 우열을 확정하지
                    않습니다.
                </label>
            )}
            <div className="flex gap-2">
                <Button variant="outline" onClick={() => void mutate()}>
                    미리보기 갱신
                </Button>
                <Button
                    disabled={pending || (data.warnings.length > 0 && !acknowledged)}
                    onClick={() =>
                        void act(`/api/email/experiments/${id}`, {
                            action: "start",
                            acknowledgeForecast: acknowledged,
                        })
                    }
                >
                    조건을 고정하고 실험 시작
                </Button>
            </div>
        </div>
    );
}
function Assignments({
    id,
    act,
    pending,
}: {
    id: number;
    act: ExperimentAction;
    pending: boolean;
}) {
    const [cursor, setCursor] = useState(0),
        [q, setQ] = useState(""),
        [selected, setSelected] = useState<number | null>(null);
    const { data, error, isLoading } = useSWR<{
        assignments: (Assignment & { generation_state: string | null; human_replies: number })[];
        nextCursor: number | null;
    }>(
        `/api/email/experiments/${id}/assignments?cursor=${cursor}&q=${encodeURIComponent(q)}`,
        copyRequest,
    );
    return (
        <details className="rounded-md border p-4">
            <summary className="cursor-pointer font-medium">배정 고객과 성과 기록</summary>
            <div className="mt-4 space-y-4">
                <Field label="고객 이메일 검색">
                    {(fieldId) => (
                        <input
                            id={fieldId}
                            className={controlClass}
                            value={q}
                            onChange={(e) => {
                                setQ(e.target.value);
                                setCursor(0);
                            }}
                        />
                    )}
                </Field>
                {isLoading ? (
                    <p>배정 고객을 불러오는 중입니다.</p>
                ) : error ? (
                    <p role="alert">배정 고객을 불러오지 못했습니다.</p>
                ) : !data?.assignments.length ? (
                    <p className="text-sm text-muted-foreground">
                        아직 배정 고객이 없습니다. 오늘 준비할 발송 자리에서 고객을 배정합니다.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr>
                                    {[
                                        "고객",
                                        "집단",
                                        "집계",
                                        "첫 예정 시각",
                                        "생성",
                                        "회신",
                                        "기록",
                                    ].map((s) => (
                                        <th key={s} className="border-b p-2">
                                            {s}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.assignments.map((a) => (
                                    <tr key={a.id}>
                                        <td className="border-b p-2">{a.normalized_email}</td>
                                        <td className="border-b p-2">{a.arm}</td>
                                        <td className="border-b p-2">
                                            {a.cohort === "primary" ? "비교 대상" : "이전 참고 집계"}
                                        </td>
                                        <td className="border-b p-2">
                                            {new Date(a.initial_scheduled_at).toLocaleString(
                                                "ko-KR",
                                            )}
                                        </td>
                                        <td className="border-b p-2">
                                            {a.generation_state
                                                ? copyStateLabel(a.generation_state)
                                                : "준비 전"}
                                        </td>
                                        <td className="border-b p-2">{a.human_replies}건</td>
                                        <td className="border-b p-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setSelected(a.id)}
                                            >
                                                성과 기록
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="flex gap-2">
                    {cursor > 0 && (
                        <Button variant="outline" onClick={() => setCursor(0)}>
                            처음
                        </Button>
                    )}
                    {data?.nextCursor && (
                        <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>
                            다음 고객
                        </Button>
                    )}
                </div>
                {selected && (
                    <OutcomeEditor
                        key={selected}
                        assignmentId={selected}
                        act={act}
                        pending={pending}
                    />
                )}
            </div>
        </details>
    );
}
