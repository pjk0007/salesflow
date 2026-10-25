"use client";
import { useState } from "react";
import { toast } from "sonner";
import { workflowRequest, workflowWrite } from "../api";
import { useWorkflowPages } from "../hooks/useWorkflowPages";
import type {
    WorkflowDetail,
    WorkflowDefinition,
    WorkflowEvent,
    Preview,
    Revision,
    Workflow,
} from "../types";
import { ConditionEditor } from "./ConditionEditor";
import { StepEditor, newWorkflowStep, type StepOptions } from "./StepEditor";
import { eventLabels, workflowEventLabel } from "../utils/labels";
export function WorkflowEditor({
    workspaceId,
    detail,
    options,
    eventTypes,
    canManage,
    onSaved,
}: {
    workspaceId: number;
    detail?: WorkflowDetail;
    options: StepOptions;
    eventTypes: string[];
    canManage: boolean;
    onSaved: (id: string) => Promise<unknown>;
}) {
    const original = detail?.revisions[0];
    const [draft, setDraft] = useState({
            version: detail?.workflow.version ?? 0,
            name: detail?.workflow.name ?? "",
            description: detail?.workflow.description ?? "",
            definition: original?.definition ?? {
                trigger: {
                    types: [
                        "message.created",
                    ] as WorkflowDefinition["trigger"]["types"],
                    eventName: "",
                    when: {
                        mode: "all" as const,
                        rules: [
                            {
                                path: "event.data.message.kind",
                                op: "eq" as const,
                                value: "customer",
                            },
                        ],
                    },
                },
                steps: [newWorkflowStep("tag", options.names)],
            },
        }),
        [saved, setSaved] = useState<Revision | undefined>(original),
        [dirty, setDirty] = useState(!detail),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(""),
        [preview, setPreview] = useState<Preview | null>(null),
        [eventId, setEventId] = useState(""),
        [reviewed, setReviewed] = useState(false),
        [replyApproved, setReplyApproved] = useState(false),
        [loadedId, setLoadedId] = useState(original?.id ?? "");
    const events = useWorkflowPages<WorkflowEvent>(
            `/api/customer-workflows/events?workspaceId=${workspaceId}`,
        ),
        eventRows = events.data?.flatMap((p) => p.rows) ?? [];
    function change(part: Partial<typeof draft>) {
        setDraft((d) => ({ ...d, ...part }));
        setDirty(true);
        setReviewed(false);
        setPreview(null);
    }
    function definition(def: WorkflowDefinition) {
        change({ definition: def });
    }
    async function save() {
        setBusy(true);
        setError("");
        try {
            const value = await workflowWrite<{
                workflow: Workflow;
                revision: Revision;
            }>(
                `/api/customer-workflows${detail ? `/${detail.workflow.id}` : ""}`,
                { workspaceId, ...draft },
                detail ? "PATCH" : "POST",
            );
            setSaved(value.revision);
            setDraft((d) => ({ ...d, version: value.workflow.version }));
            setDirty(false);
            setPreview(null);
            await onSaved(value.workflow.id);
            toast.success("검토할 자동화 버전을 저장했습니다.");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function simulate() {
        if (!detail || !saved) return;
        setBusy(true);
        setError("");
        try {
            setPreview(
                await workflowWrite<Preview>(
                    `/api/customer-workflows/${detail.workflow.id}`,
                    { action: "preview", revisionId: saved.id, eventId },
                ),
            );
            setReviewed(false);
            setReplyApproved(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function publish() {
        if (!detail || !saved || !preview) return;
        setBusy(true);
        setError("");
        try {
            await workflowWrite(
                `/api/customer-workflows/${detail.workflow.id}`,
                {
                    action: "publish",
                    version: draft.version,
                    revisionId: saved.id,
                    previewId: preview.id,
                    allowCustomerReplies: replyApproved,
                },
            );
            const latest = await workflowRequest<WorkflowDetail>(
                `/api/customer-workflows/${detail.workflow.id}`,
            );
            setDraft((d) => ({ ...d, version: latest.workflow.version }));
            setSaved(latest.revisions.find((r) => r.id === saved.id));
            await onSaved(detail.workflow.id);
            toast.success(
                "검토한 버전을 게시했습니다. 이후 새 이벤트부터 사용합니다.",
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const field =
            "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm",
        hasReply = draft.definition.steps.some((s) => s.kind === "reply"),
        stale = detail && detail.workflow.version !== draft.version;
    return (
        <section className="space-y-4">
            <header>
                <h2 className="font-semibold">
                    {detail ? "자동화 편집·검토" : "새 고객 자동화"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                    단계마다 조건을 확인하고 맞지 않으면 다음 단계로 이동합니다.
                    저장은 새 버전을 만들며, 게시한 뒤의 새 이벤트부터
                    실행합니다.
                </p>
            </header>
            {stale && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
                    다른 변경이 있습니다. 작성 중인 내용은 보존했습니다.
                    <button
                        className="ml-2 underline"
                        onClick={() => {
                            setDraft({
                                version: detail.workflow.version,
                                name: detail.workflow.name,
                                description: detail.workflow.description,
                                definition: detail.revisions[0].definition,
                            });
                            setSaved(detail.revisions[0]);
                            setDirty(false);
                            setPreview(null);
                        }}
                    >
                        최신 버전 불러오기
                    </button>
                </p>
            )}
            <details open className="space-y-3">
                <summary className="cursor-pointer text-sm font-semibold">
                    조건·단계 편집
                </summary>
                <fieldset disabled={!canManage || busy} className="space-y-4">
                    <label className="block text-xs">
                        자동화 이름
                        <input
                            aria-label="자동화 이름"
                            className={field}
                            value={draft.name}
                            maxLength={100}
                            onChange={(e) => change({ name: e.target.value })}
                        />
                    </label>
                    <label className="block text-xs">
                        설명
                        <textarea
                            className={field}
                            value={draft.description}
                            maxLength={1000}
                            onChange={(e) =>
                                change({ description: e.target.value })
                            }
                        />
                    </label>
                    {detail && (
                        <details>
                            <summary className="cursor-pointer text-xs">
                                이전 버전에서 다시 시작
                            </summary>
                            <select
                                aria-label="불러올 자동화 버전"
                                className={field}
                                value={loadedId}
                                onChange={(e) => setLoadedId(e.target.value)}
                            >
                                {detail.revisions.map((r) => (
                                    <option key={r.id} value={r.id}>
                                        버전 {r.version} ·{" "}
                                        {r.publishedAt
                                            ? "게시 이력 있음"
                                            : "초안"}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="mt-2 text-xs underline"
                                onClick={() => {
                                    const rev = detail.revisions.find(
                                        (r) => r.id === loadedId,
                                    );
                                    if (rev) {
                                        change({
                                            definition: structuredClone(
                                                rev.definition,
                                            ),
                                        });
                                        setSaved(undefined);
                                    }
                                }}
                            >
                                이 버전으로 새 초안 작성
                            </button>
                        </details>
                    )}
                    <div className="space-y-3 rounded-xl border p-4">
                        <h3 className="text-sm font-semibold">시작 이벤트</h3>
                        <div className="flex flex-wrap gap-3">
                            {eventTypes.map((type) => (
                                <label
                                    key={type}
                                    className="flex gap-1 text-xs"
                                >
                                    <input
                                        type="checkbox"
                                        checked={draft.definition.trigger.types.includes(
                                            type as WorkflowDefinition["trigger"]["types"][number],
                                        )}
                                        onChange={(e) =>
                                            definition({
                                                ...draft.definition,
                                                trigger: {
                                                    ...draft.definition.trigger,
                                                    types: (e.target.checked
                                                        ? [
                                                              ...draft
                                                                  .definition
                                                                  .trigger
                                                                  .types,
                                                              type,
                                                          ]
                                                        : draft.definition.trigger.types.filter(
                                                              (t) => t !== type,
                                                          )) as WorkflowDefinition["trigger"]["types"],
                                                },
                                            })
                                        }
                                    />
                                    {eventLabels[type] ?? type}
                                </label>
                            ))}
                        </div>
                        <label className="block text-xs">
                            특정 고객 행동 이름 · 고객 행동 이벤트에만 적용
                            <input
                                aria-label="시작 고객 이벤트 이름"
                                className={field}
                                placeholder="예: pricing.viewed"
                                value={draft.definition.trigger.eventName}
                                onChange={(e) =>
                                    definition({
                                        ...draft.definition,
                                        trigger: {
                                            ...draft.definition.trigger,
                                            eventName: e.target.value,
                                        },
                                    })
                                }
                            />
                        </label>
                        <ConditionEditor
                            prefix="시작"
                            value={draft.definition.trigger.when}
                            onChange={(when) =>
                                definition({
                                    ...draft.definition,
                                    trigger: {
                                        ...draft.definition.trigger,
                                        when,
                                    },
                                })
                            }
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        내부 고객과 같은 조직의 활성 팀원 이메일은 제외합니다.
                        자동화가 만든 이벤트는 다른 자동화를 다시 시작하지
                        않습니다.
                    </p>
                    {draft.definition.steps.map((step, i) => (
                        <StepEditor
                            key={step.id}
                            value={step}
                            index={i}
                            total={draft.definition.steps.length}
                            options={options}
                            onChange={(next) =>
                                definition({
                                    ...draft.definition,
                                    steps: draft.definition.steps.map((s, j) =>
                                        i === j ? next : s,
                                    ),
                                })
                            }
                            onDelete={() =>
                                definition({
                                    ...draft.definition,
                                    steps: draft.definition.steps.filter(
                                        (_, j) => j !== i,
                                    ),
                                })
                            }
                            onMove={(by) => {
                                const steps = [...draft.definition.steps];
                                [steps[i], steps[i + by]] = [
                                    steps[i + by],
                                    steps[i],
                                ];
                                definition({ ...draft.definition, steps });
                            }}
                        />
                    ))}
                    <button
                        type="button"
                        className="rounded-lg border px-3 py-2 text-xs"
                        disabled={draft.definition.steps.length >= 20}
                        onClick={() =>
                            definition({
                                ...draft.definition,
                                steps: [
                                    ...draft.definition.steps,
                                    newWorkflowStep("task", options.names),
                                ],
                            })
                        }
                    >
                        단계 추가
                    </button>
                    <p className="text-xs text-muted-foreground">
                        문구의 개인화 변수: {"{{contact.name}}"},{" "}
                        {"{{company.name}}"}, {"{{conversation.name}}"},{" "}
                        {"{{deal.title}}"}, {"{{task.title}}"}. 연결 대상이
                        없으면 해당 행동은 제외되며 실행 이력에 사유를 남깁니다.
                    </p>
                    <button
                        type="button"
                        disabled={busy || !draft.name.trim()}
                        onClick={() => void save()}
                        className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-40"
                    >
                        검토할 새 버전 저장
                    </button>
                </fieldset>
            </details>
            {error && (
                <p role="alert" className="text-sm text-red-600">
                    {error}
                </p>
            )}
            {detail && saved && (
                <div className="space-y-3 rounded-xl border p-4">
                    <h3 className="font-semibold">모의 실행·게시</h3>
                    <p className="text-xs text-muted-foreground">
                        같은 사업의 이벤트로 예상 행동을 확인합니다. 고객
                        메시지나 업무를 실제로 만들지 않습니다. 대기 이후 조건은
                        실제 처리 시점에 다시 평가합니다.
                    </p>
                    <select
                        aria-label="모의 실행 이벤트"
                        className={field}
                        value={eventId}
                        onChange={(e) => {
                            setEventId(e.target.value);
                            setPreview(null);
                            setReviewed(false);
                        }}
                    >
                        <option value="">검토할 이벤트 선택</option>
                        {eventRows.map((event) => (
                            <option key={event.id} value={event.id}>
                                {new Date(event.createdAt).toLocaleString(
                                    "ko-KR",
                                )}{" "}
                                · {workflowEventLabel(event)}
                            </option>
                        ))}
                    </select>
                    {events.data && !events.error && !eventRows.length && (
                        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                            아직 이 사업에 모의 실행할 이벤트가 없습니다. 게시하려면
                            실제 이벤트로 모의 실행을 통과해야 합니다.{" "}
                            <a
                                className="underline"
                                href={`/customer-crm?workspaceId=${workspaceId}&resource=contacts`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                고객 관리에서 시험용 고객을 추가
                            </a>
                            하면 &apos;고객 등록&apos; 이벤트가 생깁니다. 상담·딜 등
                            다른 시작 이벤트도 해당 화면에서 한 번 만들면 여기에
                            나타납니다. 그 뒤 &apos;새 이벤트 불러오기&apos;를
                            눌러주세요.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={() => void events.mutate()}
                        className="text-xs underline"
                    >
                        새 이벤트 불러오기
                    </button>
                    {events.error && <p role="alert">{events.error.message}</p>}
                    {events.data?.at(-1)?.hasMore && (
                        <button
                            className="text-xs underline"
                            onClick={() => void events.setSize(events.size + 1)}
                        >
                            이전 이벤트 더 보기
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={!canManage || busy || dirty || !eventId}
                        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
                        onClick={() => void simulate()}
                    >
                        저장한 버전으로 모의 실행
                    </button>
                    {dirty && (
                        <p className="text-xs text-amber-800">
                            편집 내용부터 새 버전으로 저장해주세요.
                        </p>
                    )}
                    {preview && (
                        <article
                            aria-label="자동화 모의 실행 결과"
                            className="space-y-3 text-sm"
                        >
                            <strong>
                                {preview.report.matched
                                    ? "시작 조건 일치"
                                    : "이 예시는 시작 조건에 맞지 않습니다"}
                            </strong>
                            {preview.report.steps.map((s, i) => (
                                <p key={s.id}>
                                    {i + 1}. {s.label} ·{" "}
                                    {s.status === "planned"
                                        ? "예정"
                                        : s.status === "invalid"
                                          ? "확인 필요"
                                          : "제외"}
                                    <span className="block pl-4 text-xs text-muted-foreground">
                                        {s.detail}
                                    </span>
                                </p>
                            ))}
                            <details>
                                <summary className="cursor-pointer text-xs">
                                    검토에 사용한 고객·이벤트 원본
                                </summary>
                                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
                                    {JSON.stringify(
                                        preview.report.context,
                                        null,
                                        2,
                                    )}
                                </pre>
                            </details>
                            {canManage && (
                                <>
                                    <label className="flex gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={reviewed}
                                            onChange={(e) =>
                                                setReviewed(e.target.checked)
                                            }
                                        />
                                        예상 행동과 제외 사유를 검토했습니다.
                                    </label>
                                    {hasReply && (
                                        <label className="flex gap-2 text-xs">
                                            <input
                                                type="checkbox"
                                                checked={replyApproved}
                                                onChange={(e) =>
                                                    setReplyApproved(
                                                        e.target.checked,
                                                    )
                                                }
                                            />
                                            고객에게 보내는 문구와 발송 조건을
                                            확인했습니다.
                                        </label>
                                    )}
                                    <p className="text-xs text-amber-800">
                                        게시하면 이전 버전의 대기 실행은
                                        중단되고 이후 새 이벤트부터 적용합니다.
                                        이미 처리한 행동은 되돌리지 않습니다.
                                    </p>
                                    <button
                                        type="button"
                                        disabled={
                                            busy ||
                                            dirty ||
                                            !preview.passed ||
                                            !reviewed ||
                                            (hasReply && !replyApproved) ||
                                            !!saved.publishedAt
                                        }
                                        onClick={() => void publish()}
                                        className="rounded-lg bg-[#635BFF] px-4 py-2 text-sm text-white disabled:opacity-40"
                                    >
                                        검토한 버전 게시·활성화
                                    </button>
                                    {saved.publishedAt && (
                                        <p className="text-xs text-muted-foreground">
                                            게시한 버전은 보존합니다. 다시
                                            적용하려면 새 버전으로 저장해주세요.
                                        </p>
                                    )}
                                </>
                            )}
                        </article>
                    )}
                </div>
            )}
        </section>
    );
}
