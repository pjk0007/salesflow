"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AI_MODELS, DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { targetsFor } from "@/lib/ai-copy/defaults";
import { kstParts, kstToDate } from "@/lib/kst";
import type {
    CopyPurpose,
    KnowledgePurpose,
    KnowledgeSnapshot,
    PerformanceTargets,
    PolicySnapshot,
} from "@/lib/ai-copy/types";
import { Field, controlClass, purposeLabel } from "./Fields";
import {
    DEFAULT_MEANINGS,
    switchPurpose,
    targetFromInput,
} from "../utils/policy-form";
// 확인일은 KST 날짜로 고르고 KST 자정 순간으로 저장한다 — 다시 열거나 복제할 때도 KST 날짜로 읽어야 하루씩 밀리지 않는다.
const today = () => kstParts(new Date()).date;
type Workspaces = { id: number; name: string }[];
function BusinessField({
    value,
    onChange,
    workspaces,
}: {
    value: number;
    onChange: (n: number) => void;
    workspaces: Workspaces;
}) {
    return (
        <Field label="사업">
            {(id) => (
                <select
                    id={id}
                    required
                    className={controlClass}
                    value={value || ""}
                    onChange={(e) => onChange(Number(e.target.value))}
                >
                    <option value="">사업 선택</option>
                    {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </select>
            )}
        </Field>
    );
}
export function KnowledgeForm({
    workspaces,
    initial,
    onSave,
    pending,
    defaultPurposes = ["initial_email", "visit_ack"],
    description = "제품 설명·FAQ·사례·가격 중 사용할 사실을 근거와 함께 등록합니다. 방문 감사만 작성할 때는 사실 항목 없이 사업명만 등록할 수 있습니다.",
}: {
    workspaces: Workspaces;
    initial?: { workspaceId: number; snapshot: KnowledgeSnapshot };
    onSave: (body: unknown) => Promise<unknown>;
    pending: boolean;
    defaultPurposes?: KnowledgePurpose[];
    description?: string;
}) {
    const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? 0),
        [name, setName] = useState("");
    const [businessName, setBusinessName] = useState(
        initial?.snapshot.businessName ?? "",
    );
    const [claims, setClaims] = useState(
        initial?.snapshot.claims.map((c) => ({
            ...c,
            checkedAt: kstParts(new Date(c.checkedAt)).date,
        })) ?? [
            {
                text: "",
                sourceUrl: "",
                checkedAt: today(),
                purposes: defaultPurposes,
            },
        ],
    );
    // 사용할 곳을 고르지 않은 사실은 서버가 '입력 형식' 오류로만 거절하므로 저장 전에 알린다.
    const missingPurpose = claims.some(
        (c) => c.text.trim() && !c.purposes.length,
    );
    const update = (index: number, value: Partial<(typeof claims)[number]>) =>
        setClaims((items) =>
            items.map((c, i) => (i === index ? { ...c, ...value } : c)),
        );
    return (
        <form
            className="space-y-4"
            onSubmit={async (e) => {
                e.preventDefault();
                await onSave({
                    workspaceId,
                    name,
                    snapshot: {
                        businessName,
                        claims: claims
                            .filter((c) => c.text.trim())
                            .map((c) => ({
                                ...c,
                                checkedAt: kstToDate(c.checkedAt, 0).toISOString(),
                            })),
                    },
                });
            }}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <BusinessField
                    value={workspaceId}
                    onChange={(n) => {
                        setWorkspaceId(n);
                        if (!businessName)
                            setBusinessName(
                                workspaces.find((w) => w.id === n)?.name ?? "",
                            );
                    }}
                    workspaces={workspaces}
                />
                <Field label="버전 이름">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            placeholder="예: 10월 서비스 안내"
                        />
                    )}
                </Field>
            </div>
            <Field label="고객에게 안내할 사업명">
                {(id) => (
                    <input
                        id={id}
                        className={controlClass}
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        required
                    />
                )}
            </Field>
            <p className="text-sm text-muted-foreground">{description}</p>
            {claims.map((claim, index) => (
                <fieldset
                    key={index}
                    className="space-y-3 rounded-md border p-4"
                >
                    <legend className="px-1 text-sm">
                        안내할 사실 {index + 1}
                    </legend>
                    <Field label="확인한 사실">
                        {(id) => (
                            <textarea
                                id={id}
                                className={controlClass}
                                value={claim.text}
                                onChange={(e) =>
                                    update(index, { text: e.target.value })
                                }
                                rows={2}
                            />
                        )}
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="근거 URL">
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="url"
                                    value={claim.sourceUrl}
                                    required={!!claim.text.trim()}
                                    onChange={(e) =>
                                        update(index, {
                                            sourceUrl: e.target.value,
                                        })
                                    }
                                />
                            )}
                        </Field>
                        <Field label="확인일">
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="date"
                                    value={claim.checkedAt}
                                    required={!!claim.text.trim()}
                                    onChange={(e) =>
                                        update(index, {
                                            checkedAt: e.target.value,
                                        })
                                    }
                                />
                            )}
                        </Field>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                        {(
                            [
                                "initial_email",
                                "visit_ack",
                                "customer_chat",
                            ] as KnowledgePurpose[]
                        ).map((p) => (
                            <label key={p} className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={claim.purposes.includes(p)}
                                    onChange={(e) =>
                                        update(index, {
                                            purposes: e.target.checked
                                                ? [...claim.purposes, p]
                                                : claim.purposes.filter(
                                                      (x) => x !== p,
                                                  ),
                                        })
                                    }
                                />
                                {purposeLabel(p)}
                            </label>
                        ))}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                setClaims((items) =>
                                    items.filter((_, i) => i !== index),
                                )
                            }
                        >
                            항목 삭제
                        </Button>
                    </div>
                    {claim.text.trim() && !claim.purposes.length && (
                        <p className="text-xs text-amber-700">
                            이 사실을 사용할 곳(첫 소개 메일·방문 감사
                            메일·고객 상담)을 하나 이상 선택해주세요.
                        </p>
                    )}
                </fieldset>
            ))}
            <div className="flex gap-3">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                        setClaims((items) => [
                            ...items,
                            {
                                text: "",
                                sourceUrl: "",
                                checkedAt: today(),
                                purposes: defaultPurposes,
                            },
                        ])
                    }
                >
                    사실 추가
                </Button>
                <Button disabled={pending || missingPurpose} type="submit">
                    새 지식 버전 저장
                </Button>
            </div>
        </form>
    );
}
const targetLabels: {
    key: keyof Omit<PerformanceTargets, "overrideReason">;
    label: string;
    scale: number;
}[] = [
    { key: "p95Ms", label: "95% 생성 시간 이내 초", scale: 1000 },
    { key: "p99Ms", label: "99% 생성 시간 이내 초", scale: 1000 },
    { key: "firstAttemptSuccess", label: "첫 생성 성공률 최소 %", scale: 0.01 },
    {
        key: "readyWithin30Minutes",
        label: "30분 내 준비 성공률 최소 %",
        scale: 0.01,
    },
    { key: "queueP95Ms", label: "95% 준비 완료 시간 이내 초", scale: 1000 },
    { key: "duplicateRate", label: "본문 중복률 최대 %", scale: 0.01 },
    { key: "questionShare", label: "같은 질문 비율 최대 %", scale: 0.01 },
    { key: "costRatio", label: "기준안 대비 비용 최대 %", scale: 0.01 },
];
export function PolicyForm({
    workspaces,
    initial,
    onSave,
    pending,
    models,
}: {
    workspaces: Workspaces;
    initial?: { workspaceId: number; snapshot: PolicySnapshot };
    onSave: (body: unknown) => Promise<unknown>;
    pending: boolean;
    /** 서버에 키가 있는 공급자인지(UX-244). 없으면 연결 여부를 표시하지 않는다. */
    models?: { id: string; configured: boolean }[];
}) {
    const startPurpose = initial?.snapshot.purpose ?? "visit_ack";
    const [workspaceId, setWorkspaceId] = useState(initial?.workspaceId ?? 0),
        [name, setName] = useState("");
    const [purpose, setPurpose] = useState<CopyPurpose>(startPurpose),
        [model, setModel] = useState(
            initial?.snapshot.model ?? DEFAULT_MODEL_ID,
        );
    const [instructions, setInstructions] = useState(
        initial?.snapshot.instructions ??
            "정중한 실무자의 말투로, 부담을 주지 않는 짧은 문장을 자연스럽게 변주하세요.",
    );
    const [meanings, setMeanings] = useState(
        initial?.snapshot.requiredMeanings.join("\n") ?? DEFAULT_MEANINGS.visit_ack,
    );
    const [forbidden, setForbidden] = useState(
        initial?.snapshot.forbiddenPhrases.join("\n") ??
            "지금 바로\n마지막 기회",
    );
    const [maxCharacters, setMaxCharacters] = useState(
            initial?.snapshot.maxCharacters ?? 600,
        ),
        [parameters, setParameters] = useState(
            initial?.snapshot.parameters ?? {
                maxOutputTokens: 2048,
                temperature: 0.8,
            },
        );
    const [targets, setTargets] = useState(
        initial?.snapshot.targets ?? targetsFor(startPurpose),
    );
    // 입력 중인 칸의 글자 그대로(빈 칸 포함). 저장 값은 targets에 반올림해 둔다(UX-243).
    const [targetDrafts, setTargetDrafts] = useState<Partial<Record<string, string>>>({});
    const configured = (id: string) => models?.find((m) => m.id === id)?.configured ?? true;
    return (
        <form
            className="space-y-4"
            onSubmit={async (e) => {
                e.preventDefault();
                const selected = AI_MODELS.find((m) => m.id === model)!;
                await onSave({
                    workspaceId,
                    name,
                    snapshot: {
                        purpose,
                        provider: selected.provider,
                        model,
                        parameters,
                        instructions,
                        requiredMeanings: meanings
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        forbiddenPhrases: forbidden
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        maxCharacters,
                        validatorVersion: "copy-v1",
                        targets,
                    },
                });
            }}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <BusinessField
                    value={workspaceId}
                    onChange={setWorkspaceId}
                    workspaces={workspaces}
                />
                <Field label="버전 이름">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="예: 부담 없는 질문형"
                        />
                    )}
                </Field>
                <Field label="사용 목적">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={purpose}
                            onChange={(e) => {
                                const value = e.target.value as CopyPurpose;
                                // 기본값 그대로인 항목만 바꾸고 직접 고친 내용은 보존한다(UX-245).
                                const next = switchPurpose(
                                    { meanings, maxCharacters, targets },
                                    purpose,
                                    value,
                                );
                                setPurpose(value);
                                setTargets(next.targets);
                                setTargetDrafts({});
                                setMaxCharacters(next.maxCharacters);
                                setMeanings(next.meanings);
                            }}
                        >
                            {["initial_email", "visit_ack"].map((p) => (
                                <option key={p} value={p}>
                                    {purposeLabel(p)}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
                <Field
                    label="생성 모델"
                    help={
                        configured(model)
                            ? undefined
                            : "이 모델은 서버에 AI 연결이 없어 생성이 'AI 연결 확인 필요'로 보류됩니다. 연결된 모델을 골라 주세요."
                    }
                >
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                        >
                            {AI_MODELS.map((m) => (
                                <option
                                    key={m.id}
                                    value={m.id}
                                    // 미연결 모델은 고를 수 없게 하되, 복제한 버전의 기존 값은 그대로 보여 준다(UX-244).
                                    disabled={!configured(m.id) && m.id !== initial?.snapshot.model}
                                >
                                    {m.label}
                                    {configured(m.id) ? "" : " · 연결 필요"}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
            </div>
            <Field
                label="작성 지침"
                help="고정 본문을 붙여 넣기보다 말투·질문 방식·변주 범위를 적어 주세요."
            >
                {(id) => (
                    <textarea
                        id={id}
                        className={controlClass}
                        rows={4}
                        minLength={10}
                        required
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                    />
                )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field
                    label="반드시 전달할 의미"
                    help="한 줄에 한 항목씩 적습니다."
                >
                    {(id) => (
                        <textarea
                            id={id}
                            className={controlClass}
                            rows={3}
                            required
                            value={meanings}
                            onChange={(e) => setMeanings(e.target.value)}
                        />
                    )}
                </Field>
                <Field label="사용하지 않을 표현">
                    {(id) => (
                        <textarea
                            id={id}
                            className={controlClass}
                            rows={3}
                            value={forbidden}
                            onChange={(e) => setForbidden(e.target.value)}
                        />
                    )}
                </Field>
            </div>
            <Field label="본문 최대 글자 수">
                {(id) => (
                    <input
                        id={id}
                        className={controlClass}
                        type="number"
                        min={100}
                        max={purpose === "visit_ack" ? 600 : 12000}
                        value={maxCharacters}
                        onChange={(e) =>
                            setMaxCharacters(Number(e.target.value))
                        }
                    />
                )}
            </Field>
            <details className="rounded-md border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                    성능 기준과 생성 설정
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {targetLabels.map((t) => (
                        <Field key={t.key} label={t.label}>
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="number"
                                    step="any"
                                    value={
                                        targetDrafts[t.key] ??
                                        String(Number((targets[t.key] / t.scale).toFixed(3)))
                                    }
                                    onChange={(e) => {
                                        const raw = e.target.value;
                                        setTargetDrafts((d) => ({ ...d, [t.key]: raw }));
                                        const value = targetFromInput(raw, t.scale);
                                        if (value !== null)
                                            setTargets((v) => ({ ...v, [t.key]: value }));
                                    }}
                                    required
                                />
                            )}
                        </Field>
                    ))}
                    <Field label="표현의 변동 폭 0~1">
                        {(id) => (
                            <input
                                id={id}
                                className={controlClass}
                                type="number"
                                min={0}
                                max={1}
                                step={0.1}
                                value={parameters.temperature}
                                onChange={(e) =>
                                    setParameters((p) => ({
                                        ...p,
                                        temperature: Number(e.target.value),
                                    }))
                                }
                            />
                        )}
                    </Field>
                    <Field label="최대 출력 토큰">
                        {(id) => (
                            <input
                                id={id}
                                className={controlClass}
                                type="number"
                                min={256}
                                max={8192}
                                value={parameters.maxOutputTokens}
                                onChange={(e) =>
                                    setParameters((p) => ({
                                        ...p,
                                        maxOutputTokens: Number(e.target.value),
                                    }))
                                }
                            />
                        )}
                    </Field>
                </div>
                <div className="mt-4">
                    <Field
                        label="성능 기준 변경 사유"
                        help="초기 목표를 바꾸는 경우 근거를 기록해야 합니다."
                    >
                        {(id) => (
                            <textarea
                                id={id}
                                className={controlClass}
                                value={targets.overrideReason ?? ""}
                                onChange={(e) =>
                                    setTargets((v) => ({
                                        ...v,
                                        overrideReason:
                                            e.target.value || undefined,
                                    }))
                                }
                            />
                        )}
                    </Field>
                </div>
            </details>
            <Button disabled={pending} type="submit">
                새 작성 지침 버전 저장
            </Button>
        </form>
    );
}
