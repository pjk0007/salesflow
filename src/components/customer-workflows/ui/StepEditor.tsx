"use client";
import type { ReactNode } from "react";
import type { WorkflowStep } from "../types";
import { ConditionEditor } from "./ConditionEditor";
import type { RoutingTeam } from "@/components/inbox-routing/types";
export type StepOptions = {
    members: { id: string; name: string }[];
    teams: RoutingTeam[];
    pipelines: {
        id: string;
        name: string;
        stages: { id: string; name: string }[];
    }[];
    names: Record<string, string>;
};
export function newWorkflowStep(
    kind: WorkflowStep["kind"],
    names: Record<string, string>,
): WorkflowStep {
    const base = {
        id: crypto.randomUUID(),
        label: names[kind],
        when: { mode: "all" as const, rules: [] },
    };
    switch (kind) {
        case "wait":
            return { ...base, kind, minutes: 30 };
        case "tag":
            return { ...base, kind, tag: "관심 고객", remove: false };
        case "assign":
            return { ...base, kind, assigneeId: null };
        case "team":
            return { ...base, kind, teamId: "", onlyUnassigned: true };
        case "status":
            return { ...base, kind, status: "open" };
        case "task":
            return {
                ...base,
                kind,
                title: "고객 후속 문의 확인",
                body: "상담 내용과 진행 거래를 확인해주세요.",
                ownerId: null,
                dueMinutes: 1440,
            };
        case "contact_stage":
            return { ...base, kind, stage: "prospect" };
        case "deal_stage":
            return { ...base, kind, pipelineId: "", stageId: "" };
        case "reply":
            return {
                ...base,
                kind,
                body: "안녕하세요 {{conversation.name}}님, 문의 주셔서 감사합니다. 확인 후 안내드리겠습니다.",
            };
        case "event":
            return { ...base, kind, name: "workflow.followup" };
        default:
            return { ...base, kind: "handoff" };
    }
}
export function StepEditor({
    value,
    index,
    total,
    onChange,
    onMove,
    onDelete,
    options,
}: {
    value: WorkflowStep;
    index: number;
    total: number;
    onChange: (v: WorkflowStep) => void;
    onMove: (by: number) => void;
    onDelete: () => void;
    options: StepOptions;
}) {
    const input = "w-full rounded-lg border bg-background px-3 py-2 text-sm",
        field = (label: string, child: ReactNode) => (
            <label className="block space-y-1 text-xs">
                {label}
                {child}
            </label>
        );
    const people = (
        id: string | null,
        onSelect: (id: string | null) => void,
    ) => (
        <select
            aria-label={`단계 ${index + 1} 담당자`}
            className={input}
            value={id ?? ""}
            onChange={(e) => onSelect(e.target.value || null)}
        >
            <option value="">미지정</option>
            {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                    {m.name}
                </option>
            ))}
        </select>
    );
    return (
        <article className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap gap-2">
                <strong className="mr-auto text-sm">
                    {index + 1}. {options.names[value.kind]}
                </strong>
                <button
                    type="button"
                    disabled={!index}
                    aria-label={`단계 ${index + 1} 위로`}
                    onClick={() => onMove(-1)}
                >
                    ↑
                </button>
                <button
                    type="button"
                    disabled={index === total - 1}
                    aria-label={`단계 ${index + 1} 아래로`}
                    onClick={() => onMove(1)}
                >
                    ↓
                </button>
                <button
                    type="button"
                    aria-label={`단계 ${index + 1} 삭제`}
                    onClick={onDelete}
                >
                    삭제
                </button>
            </div>
            {field(
                "단계 이름",
                <input
                    aria-label={`단계 ${index + 1} 이름`}
                    className={input}
                    value={value.label}
                    maxLength={100}
                    onChange={(e) =>
                        onChange({ ...value, label: e.target.value })
                    }
                />,
            )}
            <select
                aria-label={`단계 ${index + 1} 행동`}
                className={input}
                value={value.kind}
                onChange={(e) => {
                    const next = newWorkflowStep(
                        e.target.value as WorkflowStep["kind"],
                        options.names,
                    );
                    onChange({ ...next, id: value.id, when: value.when });
                }}
            >
                {Object.entries(options.names).map(([v, label]) => (
                    <option key={v} value={v}>
                        {label}
                    </option>
                ))}
            </select>
            {value.kind === "wait" &&
                field(
                    "대기 시간 · 분",
                    <input
                        aria-label={`단계 ${index + 1} 대기 분`}
                        type="number"
                        min={1}
                        max={43200}
                        className={input}
                        value={value.minutes}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                minutes: Number(e.target.value),
                            })
                        }
                    />,
                )}
            {value.kind === "tag" && (
                <div className="flex gap-2">
                    <input
                        aria-label={`단계 ${index + 1} 태그`}
                        className={input}
                        value={value.tag}
                        maxLength={40}
                        onChange={(e) =>
                            onChange({ ...value, tag: e.target.value })
                        }
                    />
                    <select
                        className={input}
                        value={String(value.remove)}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                remove: e.target.value === "true",
                            })
                        }
                    >
                        <option value="false">추가</option>
                        <option value="true">제거</option>
                    </select>
                </div>
            )}
            {value.kind === "assign" &&
                field(
                    "배정할 담당자",
                    people(value.assigneeId, (id) =>
                        onChange({ ...value, assigneeId: id }),
                    ),
                )}
            {value.kind === "team" && (
                <>
                    {field(
                        "배정할 상담팀",
                        <select
                            aria-label={`단계 ${index + 1} 상담팀`}
                            className={input}
                            value={value.teamId}
                            onChange={(e) =>
                                onChange({ ...value, teamId: e.target.value })
                            }
                        >
                            <option value="">상담팀 선택</option>
                            {value.teamId &&
                                !options.teams.some(
                                    (t) => t.id === value.teamId,
                                ) && (
                                    <option value={value.teamId} disabled>
                                        사용 불가한 팀 · 다시 선택해주세요
                                    </option>
                                )}
                            {options.teams.map((t) => (
                                <option
                                    key={t.id}
                                    value={t.id}
                                    disabled={!t.enabled}
                                >
                                    {t.name} ·{" "}
                                    {!t.enabled
                                        ? "보관됨"
                                        : t.autoAssign
                                          ? "자동 배정"
                                          : "수동 배정"}
                                </option>
                            ))}
                        </select>,
                    )}
                    {field(
                        "기존 배정 처리",
                        <select
                            aria-label={`단계 ${index + 1} 팀 배정 방식`}
                            className={input}
                            value={String(value.onlyUnassigned)}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    onlyUnassigned: e.target.value === "true",
                                })
                            }
                        >
                            <option value="true">
                                팀·담당자가 없는 상담에만 배정
                            </option>
                            <option value="false">
                                기존 팀·개인 배정을 선택한 팀으로 교체
                            </option>
                        </select>,
                    )}
                    <p className="text-xs text-muted-foreground">
                        선택한 팀의 설정을 따릅니다. 수동 팀이거나 응대 가능한
                        팀원이 없으면 팀 대기열에 남깁니다. 같은 팀이면 기존
                        담당을 유지합니다.
                    </p>
                    {!value.onlyUnassigned && (
                        <p className="text-xs text-amber-800">
                            다른 팀으로 이동하면 기존 개인 담당이 해제되며, 자동
                            팀은 실행 시점의 상담 수를 기준으로 다시 배정합니다.
                        </p>
                    )}
                    {!options.teams.some((t) => t.enabled) && (
                        <p className="text-xs text-amber-800">
                            사용할 팀이 없습니다. 고객 상담의 상담팀 설정에서
                            먼저 팀을 만들어주세요.
                        </p>
                    )}
                </>
            )}
            {value.kind === "status" &&
                field(
                    "변경할 상담 상태",
                    <select
                        className={input}
                        value={value.status}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                status: e.target.value as typeof value.status,
                            })
                        }
                    >
                        <option value="open">진행중</option>
                        <option value="snoozed">보류중</option>
                        <option value="closed">종료됨</option>
                    </select>,
                )}
            {value.kind === "task" && (
                <>
                    {field(
                        "할 일 제목",
                        <input
                            aria-label={`단계 ${index + 1} 업무 제목`}
                            className={input}
                            value={value.title}
                            maxLength={200}
                            onChange={(e) =>
                                onChange({ ...value, title: e.target.value })
                            }
                        />,
                    )}
                    {field(
                        "업무 내용",
                        <textarea
                            className={input}
                            value={value.body}
                            maxLength={2000}
                            onChange={(e) =>
                                onChange({ ...value, body: e.target.value })
                            }
                        />,
                    )}
                    {field(
                        "업무 담당자",
                        people(value.ownerId, (id) =>
                            onChange({ ...value, ownerId: id }),
                        ),
                    )}
                    {field(
                        "처리 시점부터 마감까지 · 분, 0이면 기한 없음",
                        <input
                            type="number"
                            min={0}
                            max={43200}
                            className={input}
                            value={value.dueMinutes}
                            onChange={(e) =>
                                onChange({
                                    ...value,
                                    dueMinutes: Number(e.target.value),
                                })
                            }
                        />,
                    )}
                </>
            )}
            {value.kind === "contact_stage" &&
                field(
                    "고객 단계",
                    <select
                        className={input}
                        value={value.stage}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                stage: e.target.value as typeof value.stage,
                            })
                        }
                    >
                        <option value="lead">리드</option>
                        <option value="prospect">잠재 고객</option>
                        <option value="customer">고객</option>
                        <option value="inactive">비활성</option>
                    </select>,
                )}
            {value.kind === "deal_stage" && (
                <>
                    <select
                        aria-label={`단계 ${index + 1} 파이프라인`}
                        className={input}
                        value={value.pipelineId}
                        onChange={(e) =>
                            onChange({
                                ...value,
                                pipelineId: e.target.value,
                                stageId: "",
                            })
                        }
                    >
                        <option value="">파이프라인 선택</option>
                        {options.pipelines.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label={`단계 ${index + 1} 딜 단계`}
                        className={input}
                        value={value.stageId}
                        onChange={(e) =>
                            onChange({ ...value, stageId: e.target.value })
                        }
                    >
                        <option value="">딜 단계 선택</option>
                        {options.pipelines
                            .find((p) => p.id === value.pipelineId)
                            ?.stages.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                    </select>
                </>
            )}
            {value.kind === "reply" && (
                <>
                    {field(
                        "고객에게 보낼 안내",
                        <textarea
                            aria-label={`단계 ${index + 1} 안내 문구`}
                            className={input}
                            rows={3}
                            value={value.body}
                            maxLength={2500}
                            onChange={(e) =>
                                onChange({ ...value, body: e.target.value })
                            }
                        />,
                    )}
                    <p className="text-xs text-amber-800">
                        고객 메시지 이벤트에만 사용합니다. 새 답변·문의·사람
                        응대 또는 첨부 자료가 있으면 보내지 않습니다.
                    </p>
                </>
            )}
            {value.kind === "event" &&
                field(
                    "기록할 고객 이벤트 이름",
                    <input
                        className={input}
                        value={value.name}
                        maxLength={100}
                        onChange={(e) =>
                            onChange({ ...value, name: e.target.value })
                        }
                    />,
                )}
            {value.kind === "handoff" && (
                <p className="text-xs text-muted-foreground">
                    사람 응대로 바꾸고 중요 상담으로 표시합니다. 담당자 배정은
                    별도 단계로 설정하세요.
                </p>
            )}
            <details>
                <summary className="cursor-pointer text-xs">
                    이 단계의 실행 조건 · {value.when.rules.length}개
                </summary>
                <ConditionEditor
                    value={value.when}
                    prefix={`단계 ${index + 1}`}
                    onChange={(when) => onChange({ ...value, when })}
                />
            </details>
        </article>
    );
}
