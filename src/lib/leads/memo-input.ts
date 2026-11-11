import type { MemoAttachment } from "@/lib/db";

export const MEMO_KINDS = ["call", "mail", "meeting", "sms", "etc"] as const;
export type MemoKind = (typeof MEMO_KINDS)[number];

type Parsed = {
    content: string;
    kind: MemoKind | null;
    attachments: MemoAttachment[] | null;
    nextContactAt: Date | null;
};

/** 메모(댓글) 등록 입력 검사 — 내용이나 첨부 중 하나는 있어야 한다 */
export function parseMemoInput(body: unknown): { ok: true; value: Parsed } | { ok: false; error: string } {
    const b = (body ?? {}) as Record<string, unknown>;
    const content = typeof b.content === "string" ? b.content.trim() : "";

    const kind = b.kind == null || b.kind === "" ? null : (b.kind as MemoKind);
    if (kind !== null && !MEMO_KINDS.includes(kind)) return { ok: false, error: "잘못된 댓글 종류입니다." };

    let attachments: MemoAttachment[] | null = null;
    if (b.attachments != null) {
        if (!Array.isArray(b.attachments) || b.attachments.length > 10) return { ok: false, error: "첨부파일은 10개까지 올릴 수 있습니다." };
        const ok = b.attachments.every(
            (a) =>
                a && typeof a === "object" &&
                typeof a.url === "string" && /^https:\/\//.test(a.url) &&
                typeof a.name === "string" && typeof a.type === "string" && typeof a.size === "number",
        );
        if (!ok) return { ok: false, error: "첨부파일 정보가 올바르지 않습니다." };
        attachments = (b.attachments as MemoAttachment[]).map(({ url, name, type, size }) => ({ url, name, type, size }));
        if (attachments.length === 0) attachments = null;
    }

    let nextContactAt: Date | null = null;
    if (b.nextContactAt != null && b.nextContactAt !== "") {
        const d = new Date(String(b.nextContactAt));
        if (isNaN(d.getTime())) return { ok: false, error: "다음 연락일이 올바르지 않습니다." };
        nextContactAt = d;
    }

    if (!content && !attachments) return { ok: false, error: "메모 내용을 입력해주세요." };
    return { ok: true, value: { content, kind, attachments, nextContactAt } };
}
