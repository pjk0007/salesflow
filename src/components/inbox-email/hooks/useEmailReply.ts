"use client";
import { useState, useEffect } from "react";
import type {
    SendbEmailContext,
    SendbEmailReplySelection,
} from "../../../../sdk/email-types";
type Draft = {
    mode: "reply" | "reply_all" | "custom";
    sourceMessageId: number | null;
    to: string;
    cc: string;
};
const initial = (context?: SendbEmailContext): Draft => ({
    mode: "reply",
    sourceMessageId: context?.sourceMessageId ?? null,
    to: context?.replyTo.join(", ") ?? "",
    cc: "",
});
const addresses = (value: string) => [
    ...new Set(
        value
            .split(/[,;\n]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
    ),
];
export function useEmailReply(
    context: SendbEmailContext | undefined,
    storageKey: string,
) {
    const key = storageKey + ":email-recipients";
    const [draft, setDraft] = useState<Draft>(() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
            if (
                parsed &&
                ["reply", "reply_all", "custom"].includes(parsed.mode) &&
                typeof parsed.to === "string" &&
                typeof parsed.cc === "string" &&
                Number.isInteger(parsed.sourceMessageId) &&
                parsed.sourceMessageId > 0
            )
                return parsed;
        } catch {}
        return initial(context);
    });
    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(draft));
        } catch {}
    }, [key, draft]);
    const stale =
        !!context && draft.sourceMessageId !== context.sourceMessageId;
    const selection: SendbEmailReplySelection | undefined =
        draft.sourceMessageId
            ? {
                  mode: draft.mode,
                  sourceMessageId: draft.sourceMessageId,
                  ...(draft.mode === "custom"
                      ? { to: addresses(draft.to), cc: addresses(draft.cc) }
                      : {}),
              }
            : undefined;
    const recipients =
        draft.mode === "custom"
            ? { to: addresses(draft.to), cc: addresses(draft.cc) }
            : draft.mode === "reply_all"
              ? { to: context?.replyAllTo ?? [], cc: context?.replyAllCc ?? [] }
              : { to: context?.replyTo ?? [], cc: [] };
    return {
        draft,
        selection,
        recipients,
        stale,
        setMode: (mode: Draft["mode"]) =>
            setDraft((d) => ({
                ...d,
                mode,
                ...(mode === "custom"
                    ? {
                          to: recipients.to.join(", "),
                          cc: recipients.cc.join(", "),
                      }
                    : {}),
            })),
        setField: (field: "to" | "cc", value: string) =>
            setDraft((d) => ({ ...d, [field]: value })),
        reset: () => setDraft(initial(context)),
    };
}
