import { z } from "zod";
export const PRESENCE_TTL_MS = 90_000;
export const TYPING_TTL_MS = 12_000;
export const activityInput = z.enum(["viewing", "reply", "note"]);
export const heartbeatInput = z
    .object({
        channelId: z.number().int().positive(),
        sessionId: z.string().uuid(),
        sequence: z.number().int().nonnegative().max(2147483647),
        conversationId: z.string().uuid().nullable().default(null),
        activity: activityInput.default("viewing"),
        leave: z.boolean().default(false),
    })
    .strict()
    .refine(
        (v) => v.activity === "viewing" || !!v.conversationId,
        "작성 상태를 표시할 상담을 선택해주세요.",
    );
export const availabilityInput = z
    .object({
        channelId: z.number().int().positive(),
        version: z.number().int().nonnegative(),
        state: z.enum(["available", "away"]),
    })
    .strict();
export type AgentActivity = z.infer<typeof activityInput>;
export function visibleActivity(
    row: { activity: string; typingUntil: Date | null },
    now: Date,
): AgentActivity {
    return row.typingUntil &&
        row.typingUntil > now &&
        (row.activity === "reply" || row.activity === "note")
        ? row.activity
        : "viewing";
}
