"use client";
import { useState } from "react";
import type { useNoteMentions } from "../hooks/useNoteMentions";
export function NoteMentions({
    state,
    busy,
}: {
    state: ReturnType<typeof useNoteMentions>;
    busy: boolean;
}) {
    const [query, setQuery] = useState("");
    return (
        <div className="mb-3 space-y-2 text-xs">
            {!!state.selected.length && (
                <div className="flex flex-wrap gap-2">
                    {state.selected.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            disabled={busy}
                            aria-label={`${m.name} 멘션 제거`}
                            onClick={() => state.toggle(m.id)}
                            className={`rounded-full border px-2 py-1 ${m.available ? "bg-amber-100" : "text-red-700"}`}
                        >
                            @{m.name} ×
                        </button>
                    ))}
                </div>
            )}
            <details>
                <summary className="cursor-pointer font-medium">
                    팀원 멘션 · {state.ids.length}명
                </summary>
                <p className="mt-2 text-muted-foreground">
                    메모를 저장하면 선택한 팀원에게 샌드비 상담 알림을 보냅니다.
                </p>
                <input
                    aria-label="멘션할 팀원 검색"
                    className="my-2 w-full rounded border bg-background p-2"
                    placeholder="팀원 이름 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <div className="max-h-40 overflow-y-auto space-y-2">
                    {state.candidates
                        .filter((m) =>
                            m.name
                                .toLowerCase()
                                .includes(query.trim().toLowerCase()),
                        )
                        .map((m) => (
                            <label
                                key={m.id}
                                className="flex items-center gap-2"
                            >
                                <input
                                    type="checkbox"
                                    aria-label={`${m.name} 멘션`}
                                    checked={state.ids.includes(m.id)}
                                    disabled={
                                        busy ||
                                        (!state.ids.includes(m.id) &&
                                            state.ids.length >= 20)
                                    }
                                    onChange={() => state.toggle(m.id)}
                                />
                                {m.name}
                            </label>
                        ))}
                    {!state.candidates.length && (
                        <p>이 사업에서 멘션할 수 있는 팀원이 없습니다.</p>
                    )}
                </div>
            </details>
        </div>
    );
}
