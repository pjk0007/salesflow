"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ai-copy/ui/Fields";
import type { CopyCatalog, KnowledgeVersion } from "@/components/ai-copy/types";
import { plannedSamplePerArm } from "@/lib/email-experiments/sample-size";
export default function ExperimentForm({
    catalog,
    knowledge,
    members,
    initialRuleId,
    pending,
    onSave,
}: {
    catalog: CopyCatalog;
    knowledge: KnowledgeVersion[];
    members: { id: string; name: string }[];
    initialRuleId?: number;
    pending: boolean;
    onSave: (value: unknown) => Promise<unknown>;
}) {
    const initialRule = catalog.rules.find((r) => r.id === initialRuleId);
    const [workspaceId, setWorkspaceId] = useState(initialRule?.workspace_id ?? 0),
        [ruleId, setRuleId] = useState(initialRule?.id ?? 0);
    const [name, setName] = useState(""),
        [subject, setSubject] = useState(""),
        [axis, setAxis] = useState("question"),
        [hypothesis, setHypothesis] = useState("");
    const [policyAId, setPolicyAId] = useState(0),
        [policyBId, setPolicyBId] = useState(0),
        [knowledgeVersionId, setKnowledgeVersionId] = useState(0);
    const [baseline, setBaseline] = useState("5"),
        [mde, setMde] = useState("2"),
        [minimum, setMinimum] = useState("1");
    const [replySource, setReplySource] = useState("manual"),
        [owner, setOwner] = useState("");
    const [guardrails, setGuardrails] = useState({
        rejectionRate: "",
        unsubscribeRate: "",
        generationFailureRate: "",
        baselineNote: "",
    });
    const policies = catalog.versions.filter(
        (p) =>
            p.workspace_id === workspaceId &&
            p.purpose === "initial_email" &&
            p.state === "approved",
    );
    let planned: number | null = null;
    try {
        planned = plannedSamplePerArm(Number(baseline) / 100, Number(mde) / 100);
    } catch {
        /* 입력 중에는 계산을 기다린다. */
    }
    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                void onSave({
                    workspaceId,
                    ruleId,
                    name,
                    subject,
                    axis,
                    hypothesis,
                    policyAId,
                    policyBId,
                    knowledgeVersionId,
                    baselineRate: Number(baseline) / 100,
                    minimumDetectableEffect: Number(mde) / 100,
                    minimumPracticalDifference: Number(minimum) / 100,
                    replySource,
                    manualCollectionOwnerId: replySource === "manual" ? owner : null,
                    guardrails: {
                        rejectionRate: Number(guardrails.rejectionRate) / 100,
                        unsubscribeRate: Number(guardrails.unsubscribeRate) / 100,
                        generationFailureRate: Number(guardrails.generationFailureRate) / 100,
                        baselineNote: guardrails.baselineNote,
                    },
                });
            }}
        >
            <p className="text-sm text-muted-foreground">
                한 사업의 AI 자동발송 규칙에서 첫 메일 본문만 비교합니다. 고객별로 한 메일을 보내며
                각 집단 안에서도 LLM 문구 변주를 유지합니다. A/B 배정은 50:50입니다.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="사업">
                    {(id) => (
                        <select
                            id={id}
                            required
                            className={controlClass}
                            value={workspaceId || ""}
                            onChange={(e) => {
                                setWorkspaceId(Number(e.target.value));
                                setRuleId(0);
                                setPolicyAId(0);
                                setPolicyBId(0);
                                setKnowledgeVersionId(0);
                            }}
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
                <Field label="이메일 규칙">
                    {(id) => (
                        <select
                            id={id}
                            required
                            className={controlClass}
                            value={ruleId || ""}
                            onChange={(e) => setRuleId(Number(e.target.value))}
                        >
                            <option value="">선택</option>
                            {catalog.rules
                                .filter((r) => r.workspace_id === workspaceId)
                                .map((r) => (
                                    <option key={r.id} value={r.id}>
                                        {r.name ?? `규칙 #${r.id}`}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
                <Field label="실험 이름">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    )}
                </Field>
                <Field
                    label="두 집단에 공통으로 보낼 제목"
                    help="실험에서는 제목을 고정하고 본문 작성 지침만 비교합니다."
                >
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            required
                            maxLength={200}
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                        />
                    )}
                </Field>
                <Field label="바꿔 볼 한 가지">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={axis}
                            onChange={(e) => setAxis(e.target.value)}
                        >
                            <option value="question">질문 방식</option>
                            <option value="opening">도입 방식</option>
                            <option value="tone">말투</option>
                            <option value="length">문장 길이</option>
                        </select>
                    )}
                </Field>
                <Field label="예상하는 변화와 이유">
                    {(id) => (
                        <textarea
                            id={id}
                            className={controlClass}
                            required
                            minLength={10}
                            value={hypothesis}
                            onChange={(e) => setHypothesis(e.target.value)}
                            placeholder="예: 짧은 질문이 고객의 답장 부담을 줄이는지 확인합니다."
                        />
                    )}
                </Field>
                {[
                    { label: "A 기준 작성 지침", value: policyAId, set: setPolicyAId },
                    { label: "B 후보 작성 지침", value: policyBId, set: setPolicyBId },
                ].map((p) => (
                    <Field key={p.label} label={p.label}>
                        {(id) => (
                            <select
                                id={id}
                                required
                                className={controlClass}
                                value={p.value || ""}
                                onChange={(e) => p.set(Number(e.target.value))}
                            >
                                <option value="">승인 버전 선택</option>
                                {policies.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name} · #{v.id}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>
                ))}
                <Field label="공통 지식 버전">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            required
                            value={knowledgeVersionId || ""}
                            onChange={(e) => setKnowledgeVersionId(Number(e.target.value))}
                        >
                            <option value="">승인 버전 선택</option>
                            {knowledge
                                .filter(
                                    (k) => k.workspace_id === workspaceId && k.state === "approved",
                                )
                                .map((k) => (
                                    <option key={k.id} value={k.id}>
                                        {k.name} · #{k.id}
                                    </option>
                                ))}
                        </select>
                    )}
                </Field>
            </div>
            {!policies.length && (
                <p className="rounded-md bg-muted p-3 text-sm">
                    AI 품질 화면에서 첫 소개 메일 작성 지침을 평가·승인한 뒤 선택할 수 있습니다.
                </p>
            )}
            <fieldset className="grid gap-4 rounded-md border p-4 sm:grid-cols-3">
                <legend className="px-1 text-sm font-medium">성과와 표본 계획</legend>
                <Field label="현재 긍정 회신율 예상 %">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            type="number"
                            step="any"
                            min={0.01}
                            max={99}
                            required
                            value={baseline}
                            onChange={(e) => setBaseline(e.target.value)}
                        />
                    )}
                </Field>
                <Field label="탐지할 차이 %p" help="필요 표본을 계산하는 데 쓰는 차이입니다.">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            type="number"
                            step="any"
                            min={0.01}
                            max={99}
                            required
                            value={mde}
                            onChange={(e) => setMde(e.target.value)}
                        />
                    )}
                </Field>
                <Field
                    label="채택할 최소 실무 차이 %p"
                    help="통계적 차이와 별도로, 이만큼은 좋아야 채택합니다."
                >
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            type="number"
                            step="any"
                            min={0.01}
                            max={99}
                            required
                            value={minimum}
                            onChange={(e) => setMinimum(e.target.value)}
                        />
                    )}
                </Field>
                <p className="text-sm sm:col-span-3">
                    {planned === null
                        ? "값을 입력하면 필요 표본을 계산합니다."
                        : `각 집단 ${planned.toLocaleString()}명, 총 ${(planned * 2).toLocaleString()}명이 필요합니다.`}{" "}
                    최소 14일 모집 후 고객별 14일을 관찰합니다. 최대 모집 기간은 42일입니다.
                </p>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="회신 수집 방법">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={replySource}
                            onChange={(e) => setReplySource(e.target.value)}
                        >
                            <option value="manual">담당자가 확인한 회신을 수동 기록</option>
                            <option value="connected">연결된 회신 수집 사용</option>
                        </select>
                    )}
                </Field>
                {replySource === "manual" && (
                    <Field label="회신 수집 담당자">
                        {(id) => (
                            <select
                                id={id}
                                className={controlClass}
                                required
                                value={owner}
                                onChange={(e) => setOwner(e.target.value)}
                            >
                                <option value="">담당자 선택</option>
                                {members.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>
                )}
            </div>
            <fieldset className="space-y-4 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">
                    기존 실적을 바탕으로 정할 중단 기준
                </legend>
                <div className="grid gap-4 sm:grid-cols-3">
                    {(["rejectionRate", "unsubscribeRate", "generationFailureRate"] as const).map(
                        (key) => (
                            <Field
                                key={key}
                                label={
                                    {
                                        rejectionRate: "거절 고객 비율 최대 %",
                                        unsubscribeRate: "수신거부 비율 최대 %",
                                        generationFailureRate: "문구 준비 실패 비율 최대 %",
                                    }[key]
                                }
                            >
                                {(id) => (
                                    <input
                                        id={id}
                                        className={controlClass}
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="any"
                                        required
                                        value={guardrails[key]}
                                        onChange={(e) =>
                                            setGuardrails((g) => ({ ...g, [key]: e.target.value }))
                                        }
                                    />
                                )}
                            </Field>
                        ),
                    )}
                </div>
                <Field
                    label="기준을 정한 근거"
                    help="기존 회신·수신거부·생성 실적의 기간과 수준을 적습니다. 자료가 적으면 추정임을 표시해 주세요."
                >
                    {(id) => (
                        <textarea
                            id={id}
                            className={controlClass}
                            minLength={10}
                            required
                            value={guardrails.baselineNote}
                            onChange={(e) =>
                                setGuardrails((g) => ({ ...g, baselineNote: e.target.value }))
                            }
                        />
                    )}
                </Field>
            </fieldset>
            <Button disabled={pending} type="submit">
                실험 초안 저장
            </Button>
        </form>
    );
}
