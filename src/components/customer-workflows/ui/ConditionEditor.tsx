"use client";
import type { WorkflowGroup } from "../types";
import { conditionFields, conditionChoices } from "../utils/labels";
export function ConditionEditor({
    value,
    onChange,
    prefix,
}: {
    value: WorkflowGroup;
    onChange: (v: WorkflowGroup) => void;
    prefix: string;
}) {
    const fields = Object.keys(conditionFields);
    return (
        <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
                <select
                    aria-label={`${prefix} 조건 결합`}
                    className="rounded border p-2"
                    value={value.mode}
                    onChange={(e) =>
                        onChange({
                            ...value,
                            mode: e.target.value as "all" | "any",
                        })
                    }
                >
                    <option value="all">모든 조건 일치</option>
                    <option value="any">하나 이상 일치</option>
                </select>
                <button
                    type="button"
                    onClick={() =>
                        onChange({
                            ...value,
                            rules: [
                                ...value.rules,
                                {
                                    path: "event.data.message.kind",
                                    op: "eq",
                                    value: "customer",
                                },
                            ],
                        })
                    }
                    disabled={value.rules.length >= 12}
                    className="rounded border px-2 py-1"
                >
                    조건 추가
                </button>
                {!value.rules.length && (
                    <span className="text-muted-foreground">
                        조건 없음 · 모두 통과
                    </span>
                )}
            </div>
            {value.rules.map((r, i) => {
                const update = (v: Partial<typeof r>) =>
                    onChange({
                        ...value,
                        rules: value.rules.map((old, j) =>
                            i === j ? { ...old, ...v } : old,
                        ),
                    });
                return (
                    <div
                        key={i}
                        className="grid gap-2 sm:grid-cols-[1.4fr_1fr_0.7fr_1fr_auto]"
                    >
                        <div className="min-w-0 space-y-1">
                            <select
                                aria-label={`${prefix} 조건 필드 ${i + 1}`}
                                className="w-full rounded border p-2"
                                value={
                                    conditionFields[r.path] ? r.path : "custom"
                                }
                                onChange={(e) => {
                                    const path = e.target.value;
                                    if (path === "custom")
                                        update({
                                            path: "contact.attributes.분류",
                                            value: "",
                                        });
                                    else
                                        update({
                                            path,
                                            value: conditionChoices[path]
                                                ? Object.keys(
                                                      conditionChoices[path],
                                                  )[0]
                                                : [
                                                        "contact.isInternal",
                                                        "conversation.priority",
                                                    ].includes(path)
                                                  ? true
                                                  : path === "deal.amount"
                                                    ? 0
                                                    : "",
                                        });
                                }}
                            >
                                {Object.entries(conditionFields).map(
                                    ([path, label]) => (
                                        <option key={path} value={path}>
                                            {label}
                                        </option>
                                    ),
                                )}
                                <option value="custom">
                                    기타 고객·이벤트 속성
                                </option>
                            </select>
                            {!conditionFields[r.path] && (
                                <input
                                    aria-label={`${prefix} 기타 필드 경로 ${i + 1}`}
                                    className="w-full rounded border p-2"
                                    value={r.path}
                                    list={`${prefix.replace(/\s/g, "")}-fields`}
                                    onChange={(e) =>
                                        update({ path: e.target.value })
                                    }
                                />
                            )}
                        </div>
                        <select
                            aria-label={`${prefix} 비교 방식 ${i + 1}`}
                            value={r.op}
                            onChange={(e) =>
                                update({ op: e.target.value as typeof r.op })
                            }
                            className="rounded border p-2"
                        >
                            {Object.entries({
                                eq: "같음",
                                neq: "다름",
                                contains: "포함",
                                exists: "값이 있음",
                                missing: "값이 없음",
                                gte: "이상",
                                lte: "이하",
                            }).map(([v, label]) => (
                                <option key={v} value={v}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={`${prefix} 비교값 종류 ${i + 1}`}
                            className="rounded border p-2"
                            value={r.value === null ? "null" : typeof r.value}
                            onChange={(e) =>
                                update({
                                    value:
                                        e.target.value === "number"
                                            ? 0
                                            : e.target.value === "boolean"
                                              ? true
                                              : e.target.value === "null"
                                                ? null
                                                : "",
                                })
                            }
                        >
                            <option value="string">문자</option>
                            <option value="number">숫자</option>
                            <option value="boolean">예·아니오</option>
                            <option value="null">빈 값</option>
                        </select>
                        {typeof r.value === "string" &&
                        conditionChoices[r.path] ? (
                            <select
                                aria-label={`${prefix} 비교값 ${i + 1}`}
                                value={r.value}
                                className="min-w-0 rounded border p-2"
                                onChange={(e) =>
                                    update({ value: e.target.value })
                                }
                            >
                                {!Object.hasOwn(
                                    conditionChoices[r.path],
                                    r.value,
                                ) && (
                                    <option value={r.value}>
                                        {r.value || "선택"}
                                    </option>
                                )}
                                {Object.entries(conditionChoices[r.path]).map(
                                    ([v, label]) => (
                                        <option key={v} value={v}>
                                            {label}
                                        </option>
                                    ),
                                )}
                            </select>
                        ) : typeof r.value === "boolean" ? (
                            <select
                                aria-label={`${prefix} 비교값 ${i + 1}`}
                                value={String(r.value)}
                                onChange={(e) =>
                                    update({ value: e.target.value === "true" })
                                }
                                className="rounded border p-2"
                            >
                                <option value="true">예</option>
                                <option value="false">아니오</option>
                            </select>
                        ) : (
                            <input
                                aria-label={`${prefix} 비교값 ${i + 1}`}
                                disabled={
                                    r.value === null ||
                                    ["exists", "missing"].includes(r.op)
                                }
                                type={
                                    typeof r.value === "number"
                                        ? "number"
                                        : "text"
                                }
                                className="min-w-0 rounded border p-2"
                                value={r.value ?? ""}
                                onChange={(e) =>
                                    update({
                                        value:
                                            typeof r.value === "number"
                                                ? Number(e.target.value)
                                                : e.target.value,
                                    })
                                }
                            />
                        )}
                        <button
                            type="button"
                            aria-label={`${prefix} 조건 ${i + 1} 삭제`}
                            onClick={() =>
                                onChange({
                                    ...value,
                                    rules: value.rules.filter(
                                        (_, j) => j !== i,
                                    ),
                                })
                            }
                        >
                            삭제
                        </button>
                    </div>
                );
            })}
            <datalist id={`${prefix.replace(/\s/g, "")}-fields`}>
                {fields.map((f) => (
                    <option key={f} value={f} />
                ))}
            </datalist>
            <p className="text-muted-foreground">
                고객·회사·상담은 처리 시점의 최신 값입니다. event로 시작하는
                조건은 시작 이벤트 원본을 비교합니다.
            </p>
        </div>
    );
}
