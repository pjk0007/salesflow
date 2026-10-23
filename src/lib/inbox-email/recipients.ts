import { z } from "zod";
import { emailAddress } from "./rules";
export const emailReplySelection = z
    .object({
        mode: z.enum(["reply", "reply_all", "custom"]),
        sourceMessageId: z.number().int().positive(),
        to: z.array(emailAddress).max(30).optional(),
        cc: z.array(emailAddress).max(30).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
        if (v.mode !== "custom" && (v.to !== undefined || v.cc !== undefined))
            ctx.addIssue({
                code: "custom",
                message: "직접 지정 모드에서만 받는 사람을 수정할 수 있습니다.",
            });
        if (v.mode === "custom" && !v.to?.length)
            ctx.addIssue({
                code: "custom",
                message: "받는 사람을 한 명 이상 지정해주세요.",
            });
    });
export type EmailReplySelection = z.infer<typeof emailReplySelection>;
export function uniqueEmails(values: string[]) {
    return [...new Set(values.map((s) => emailAddress.parse(s)))];
}
export function replyRecipients(
    envelope: { from: string; to: string[]; cc: string[]; replyTo?: string[] },
    mailbox: string,
    mode: "reply" | "reply_all",
    otherSelf: string[] = [],
) {
    const self = uniqueEmails([mailbox, ...otherSelf]),
        omit = (a: string[]) =>
            uniqueEmails(a).filter((s) => !self.includes(s));
    const to = omit(
        envelope.replyTo?.length ? envelope.replyTo : [envelope.from],
    );
    const cc =
        mode === "reply_all"
            ? omit([...envelope.to, ...envelope.cc]).filter(
                  (s) => !to.includes(s),
              )
            : [];
    return { to, cc };
}
export function resolveRecipients(
    envelope: Parameters<typeof replyRecipients>[0],
    mailbox: string,
    selection?: EmailReplySelection,
    otherSelf: string[] = [],
) {
    const value =
        selection?.mode === "custom"
            ? {
                  to: uniqueEmails(selection.to ?? []),
                  cc: uniqueEmails(selection.cc ?? []),
              }
            : replyRecipients(
                  envelope,
                  mailbox,
                  selection?.mode ?? "reply",
                  otherSelf,
              );
    value.cc = value.cc.filter((s) => !value.to.includes(s));
    if (!value.to.length || value.to.length + value.cc.length > 30)
        throw new Error("받는 사람과 참조는 합계 1~30명으로 지정해주세요.");
    if (
        [...value.to, ...value.cc].some((a) =>
            uniqueEmails([mailbox, ...otherSelf]).includes(a),
        )
    )
        throw new Error("상담 메일함 자신을 받는 사람으로 지정할 수 없습니다.");
    return value;
}
