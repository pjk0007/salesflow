import { z } from "zod";
export const capacityInput = z
    .object({
        channelId: z.number().int().positive(),
        userId: z.string().uuid(),
        version: z.number().int().nonnegative(),
        maxOpenConversations: z.number().int().min(0).max(1000).nullable(),
    })
    .strict();
export const capacityWorkerEnabled = () =>
    process.env.NODE_ENV === "production" &&
    process.env.INBOX_ROUTING_WORKER === "on";
