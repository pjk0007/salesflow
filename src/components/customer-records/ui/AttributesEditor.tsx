"use client";
import { useState } from "react";
import { attributeRows, parseAttributeRows } from "../utils/attributes";
import type { AttributeRow, AttributeType } from "../types";
export function AttributesEditor({
    initial,
    onChange,
}: {
    initial: Record<string, unknown>;
    onChange: (value: Record<string, unknown>, error: string) => void;
}) {
    const [rows, setRows] = useState(() => attributeRows(initial)),
        [error, setError] = useState("");
    function update(next: AttributeRow[]) {
        setRows(next);
        const parsed = parseAttributeRows(next);
        setError(parsed.error);
        onChange(parsed.value, parsed.error);
    }
    function patch(id: string, value: Partial<AttributeRow>) {
        update(rows.map((r) => (r.id === id ? { ...r, ...value } : r)));
    }
    return (
        <details
            className="space-y-3 rounded-lg border p-3"
            open={rows.length > 0}
        >
            <summary className="cursor-pointer text-sm font-medium">
                추가 속성 ({rows.length})
            </summary>
            <p className="text-xs text-muted-foreground">
                관심 서비스·등급·유입 경로처럼 필요한 정보를 저장하세요. 복잡한
                기존 값은 JSON 형식으로 유지됩니다.
            </p>
            {rows.map((row, i) => (
                <div
                    key={row.id}
                    className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_100px]"
                >
                    <input
                        aria-label={`속성 ${i + 1} 이름`}
                        className="min-w-0 rounded border bg-background p-2 text-sm"
                        value={row.key}
                        maxLength={100}
                        placeholder="속성 이름"
                        onChange={(e) => patch(row.id, { key: e.target.value })}
                    />
                    <select
                        aria-label={`속성 ${i + 1} 값 종류`}
                        className="rounded border bg-background p-2 text-sm"
                        value={row.type}
                        onChange={(e) =>
                            patch(row.id, {
                                type: e.target.value as AttributeType,
                                ...(e.target.value === "boolean"
                                    ? {
                                          value:
                                              row.value === "true"
                                                  ? "true"
                                                  : "false",
                                      }
                                    : {}),
                            })
                        }
                    >
                        <option value="text">문자</option>
                        <option value="number">숫자</option>
                        <option value="boolean">예·아니요</option>
                        <option value="json">JSON</option>
                        <option value="null">빈 값</option>
                    </select>
                    {row.type === "boolean" ? (
                        <select
                            aria-label={`속성 ${i + 1} 값`}
                            className="rounded border bg-background p-2 text-sm"
                            value={row.value}
                            onChange={(e) =>
                                patch(row.id, { value: e.target.value })
                            }
                        >
                            <option value="true">예</option>
                            <option value="false">아니요</option>
                        </select>
                    ) : row.type === "null" ? (
                        <p className="p-2 text-sm">빈 값</p>
                    ) : (
                        <textarea
                            aria-label={`속성 ${i + 1} 값`}
                            className="rounded border bg-background p-2 text-sm"
                            value={row.value}
                            rows={row.type === "json" ? 3 : 1}
                            onChange={(e) =>
                                patch(row.id, { value: e.target.value })
                            }
                        />
                    )}
                    <button
                        type="button"
                        aria-label={`속성 ${i + 1} 삭제`}
                        className="text-xs text-red-700"
                        onClick={() =>
                            update(rows.filter((r) => r.id !== row.id))
                        }
                    >
                        이 속성 삭제
                    </button>
                </div>
            ))}
            {error && (
                <p role="alert" className="text-xs text-red-700">
                    {error}
                </p>
            )}
            <button
                type="button"
                className="rounded border px-3 py-2 text-xs"
                onClick={() =>
                    update([
                        ...rows,
                        {
                            id: crypto.randomUUID(),
                            key: "",
                            type: "text",
                            value: "",
                        },
                    ])
                }
            >
                속성 추가
            </button>
        </details>
    );
}
