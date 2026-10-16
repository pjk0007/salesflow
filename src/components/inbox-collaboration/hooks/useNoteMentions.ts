"use client";
import { useState, useEffect } from "react";
import type { MentionPerson } from "../types";
export function useNoteMentions(
    storageKey: string,
    members: MentionPerson[],
    workspaceId?: number,
) {
    const key = storageKey + ":note-mentions";
    const [ids, setIds] = useState<string[]>(() => {
        try {
            const parsed: unknown = JSON.parse(
                localStorage.getItem(key) ?? "[]",
            );
            if (Array.isArray(parsed))
                return [
                    ...new Set(
                        parsed.filter(
                            (v): v is string =>
                                typeof v === "string" &&
                                /^[0-9a-f-]{36}$/i.test(v),
                        ),
                    ),
                ].slice(0, 20);
        } catch {}
        return [];
    });
    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(ids));
        } catch {}
    }, [key, ids]);
    const candidates = members.filter(
        (m) => workspaceId && m.workspaceIds.includes(workspaceId),
    );
    return {
        ids,
        candidates,
        selected: ids.map((id) => ({
            id,
            name:
                candidates.find((m) => m.id === id)?.name ??
                "접근 권한 확인이 필요한 팀원",
            available: candidates.some((m) => m.id === id),
        })),
        toggle: (id: string) =>
            setIds((current) =>
                current.includes(id)
                    ? current.filter((x) => x !== id)
                    : current.length < 20
                      ? [...current, id]
                      : current,
            ),
        clear: () => setIds([]),
    };
}
