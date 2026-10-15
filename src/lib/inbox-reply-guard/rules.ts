import { z } from "zod";
export const REPLY_LEASE_TTL_MS = 90_000;
const revision = z.number().int().nonnegative().max(2147483647);
export const replyGuardContext = z
    .object({
        leaseId: z.string().uuid(),
        sessionId: z.string().uuid(),
        revision,
    })
    .strict();
export const replyGuardSettingsInput = z
    .object({
        channelId: z.number().int().positive(),
        version: revision,
        enabled: z.boolean(),
    })
    .strict();
const common = {
    conversationId: z.string().uuid(),
    sessionId: z.string().uuid(),
};
export const replyLeaseInput = z.discriminatedUnion("action", [
    z
        .object({
            ...common,
            action: z.literal("acquire"),
            revision,
            takeover: z
                .object({
                    leaseId: z.string().uuid(),
                    reason: z
                        .string()
                        .trim()
                        .min(3, "인계 사유를 3자 이상 입력해주세요.")
                        .max(300),
                })
                .strict()
                .optional(),
        })
        .strict(),
    z
        .object({
            ...common,
            action: z.literal("renew"),
            leaseId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            ...common,
            action: z.literal("release"),
            leaseId: z.string().uuid(),
        })
        .strict(),
    z
        .object({
            ...common,
            action: z.literal("acknowledge"),
            leaseId: z.string().uuid(),
            revision,
        })
        .strict(),
]);
