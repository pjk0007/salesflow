import { z } from "zod";

export const messengerSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    tagline: z.string().trim().max(120).default(""),
    consultationUrl: z
        .union([z.url().refine((s) => s.startsWith("https://")), z.literal("")])
        .default(""),
    emailNotifications: z.boolean().default(false),
});
export type MessengerSettings = z.infer<typeof messengerSettingsSchema>;
export const defaultMessengerSettings = messengerSettingsSchema.parse({});
export const contactInput = z
    .object({
        action: z.literal("contact"),
        name: z.string().trim().max(100).default(""),
        phone: z
            .string()
            .trim()
            .max(30)
            .refine(
                (s) => !s || /^\+?[\d ()-]{7,30}$/.test(s),
                "연락처를 확인해주세요.",
            )
            .default(""),
        email: z.union([z.email().max(254), z.literal("")]).default(""),
        notifyEmail: z.boolean().default(false),
    })
    .strict()
    .refine(
        (v) => !v.notifyEmail || !!v.email,
        "답변 알림을 받을 이메일을 입력해주세요.",
    );
export type ReplyContactDraft = z.infer<typeof contactInput>;
export { customerWelcome } from "@/components/customer-messenger/utils/presentation";
export function notificationWorkerEnabled(
    env: NodeJS.ProcessEnv = process.env,
) {
    return (
        env.NODE_ENV === "production" &&
        env.CUSTOMER_REPLY_NOTIFICATIONS === "on"
    );
}
export function notificationDecision(input: {
    enabled: boolean;
    consent: boolean;
    verified: boolean;
    read: boolean;
    superseded: boolean;
    historyOnly: boolean;
    medium: string;
}) {
    if (!input.enabled) return "disabled";
    if (input.historyOnly || input.medium !== "web")
        return "unsupported_conversation";
    if (!input.consent || !input.verified) return "no_verified_consent";
    if (input.superseded) return "newer_reply";
    if (input.read) return "already_read";
    return "send";
}
