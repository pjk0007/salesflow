"use client";
import { useCallback, useRef, useState } from "react";
import { inboxRequest } from "../api";
import type { ChatAttachment } from "../types";
export type FileDraft = {
    clientId: string;
    file: File;
    uploaded?: ChatAttachment;
};
export function moveAttachmentDraftGroup(
    groups: Record<string, FileDraft[]>,
    from: string,
    to: string,
): Record<string, FileDraft[]> {
    if (from === to) return groups;
    const combined = new Map<string, FileDraft>();
    for (const draft of [...(groups[to] ?? []), ...(groups[from] ?? [])]) {
        const previous = combined.get(draft.clientId);
        // Retain a completed upload even when a duplicate draft is in the destination.
        if (!previous || (!previous.uploaded && draft.uploaded))
            combined.set(draft.clientId, draft);
    }
    if (combined.size > 5)
        throw new Error("파일은 한 번에 5개까지 보낼 수 있습니다. 기존 파일을 확인해주세요.");
    return { ...groups, [from]: [], [to]: [...combined.values()] };
}
export function useAttachmentDrafts(key: string) {
    const [groups, setGroups] = useState<Record<string, FileDraft[]>>({});
    const current = useRef(groups);
    current.current = groups;
    const [progress, setProgress] = useState("");
    const reset = useCallback(() => {
        current.current = {};
        setGroups({});
        setProgress("");
    }, []);
    function update(group: string, fn: (files: FileDraft[]) => FileDraft[]) {
        current.current = {
            ...current.current,
            [group]: fn(current.current[group] ?? []),
        };
        setGroups(current.current);
    }
    const files = groups[key] ?? [];
    return {
        files,
        progress,
        signature: files.map((f) => f.clientId).join(","),
        select(list: FileList | null) {
            const selected = Array.from(list ?? []);
            if (files.length + selected.length > 5)
                throw new Error("파일은 한 번에 5개까지 보낼 수 있습니다.");
            if (selected.some((f) => !f.size || f.size > 20 * 1024 * 1024))
                throw new Error(
                    "각 파일은 0바이트보다 크고 20MB 이하여야 합니다.",
                );
            update(key, (old) => [
                ...old,
                ...selected.map((file) => ({
                    file,
                    clientId: crypto.randomUUID(),
                })),
            ]);
        },
        async remove(
            clientId: string,
            url: string,
            headers?: Record<string, string>,
        ) {
            const file = current.current[key]?.find(
                (f) => f.clientId === clientId,
            );
            if (file?.uploaded)
                await inboxRequest(url, {
                    method: "POST",
                    body: JSON.stringify({
                        action: "cancel",
                        id: file.uploaded.id,
                    }),
                    headers,
                });
            update(key, (old) => old.filter((f) => f.clientId !== clientId));
        },
        async prepare(
            url: string,
            kind: "reply" | "note" | "customer",
            headers?: Record<string, string>,
        ) {
            const selected = [...(current.current[key] ?? [])],
                ids: string[] = [];
            try {
                for (const [index, file] of selected.entries()) {
                    let uploaded = file.uploaded;
                    if (!uploaded) {
                        setProgress(
                            `파일 ${index + 1}/${selected.length} 업로드 중…`,
                        );
                        const form = new FormData();
                        form.set("file", file.file);
                        form.set("clientId", file.clientId);
                        form.set("kind", kind);
                        uploaded = await inboxRequest<ChatAttachment>(url, {
                            method: "POST",
                            body: form,
                            headers,
                        });
                        const saved = uploaded;
                        update(key, (old) =>
                            old.map((f) =>
                                f.clientId === file.clientId
                                    ? { ...f, uploaded: saved }
                                    : f,
                            ),
                        );
                    }
                    ids.push(uploaded.id);
                }
                return ids;
            } finally {
                setProgress("");
            }
        },
        clear() {
            update(key, () => []);
        },
        moveTo(newGroupKey: string) {
            const next = moveAttachmentDraftGroup(current.current, key, newGroupKey);
            current.current = next;
            setGroups(next);
        },
        reset,
    };
}
