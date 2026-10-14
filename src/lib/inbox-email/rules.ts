import { z } from "zod";
import { createHash } from "node:crypto";
const header = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .refine(
            (s) => !/[\r\n\x00-\x1f\x7f]/.test(s),
            "메일 머리글을 확인해주세요.",
        );
export const emailAddress = header(254)
    .pipe(z.email())
    .transform((s) => s.toLowerCase());
export const mailboxInput = z
    .object({
        workspaceId: z.number().int().positive(),
        address: emailAddress,
        name: header(100).min(1),
    })
    .strict();
export const mailboxPatch = z
    .object({ version: z.number().int().positive(), enabled: z.boolean() })
    .strict();
const sourceId = header(200).min(1);
export const rfcId = header(998).regex(
    /^<[^<>\s]+@[^<>\s]+>$/,
    "Message-ID를 확인해주세요.",
);
export const inboundInput = z
    .object({
        providerMessageId: sourceId,
        providerThreadId: sourceId,
        rfcMessageId: rfcId,
        from: emailAddress,
        fromName: header(100).default(""),
        to: z.array(emailAddress).max(30),
        deliveredTo: z.array(emailAddress).max(30).optional(),
        cc: z.array(emailAddress).max(30).default([]),
        replyTo: z.array(emailAddress).max(30).optional(),
        subject: header(500).default("(제목 없음)"),
        body: z.string().trim().min(1).max(100000),
        receivedAt: z.iso.datetime({ offset: true }),
        autoSubmitted: header(100).default("no"),
        precedence: header(100).default(""),
        files: z
            .array(
                z
                    .object({
                        name: header(255).min(1),
                        size: z.number().int().nonnegative(),
                        contentType: header(150),
                        providerId: header(4096).min(1),
                    })
                    .strict(),
            )
            .max(50)
            .default([]),
    })
    .strict();
export type InboundEmail = z.infer<typeof inboundInput>;
export function emailFingerprint(input: InboundEmail) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export const emailContactKey = (mailboxId: string, address: string) =>
    `email:${mailboxId}:${createHash("sha256").update(address).digest("hex")}`;
export const receiptClientId = (mailboxId: string, id: string) => {
    const s = createHash("sha256").update(`${mailboxId}\0${id}`).digest("hex");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
};
export function ignoredEmail(input: InboundEmail, mailbox: string) {
    if (input.from === mailbox) return "mailbox_self";
    if (input.autoSubmitted.toLowerCase() !== "no") return "automatic_message";
    if (["bulk", "list", "junk"].includes(input.precedence.toLowerCase()))
        return "bulk_message";
    return null;
}
