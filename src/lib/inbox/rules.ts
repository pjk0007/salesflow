import { z } from "zod";

export const messageInput = z.object({
    clientId: z.string().uuid(),
    body: z
        .string()
        .trim()
        .min(1, "메시지를 입력해주세요.")
        .max(5000, "메시지는 5,000자까지 입력할 수 있습니다."),
});
export const replyInput = messageInput.extend({
    kind: z.enum(["reply", "note"]),
});
export const sessionInput = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.union([z.email(), z.literal("")]).optional(),
    pageUrl: z.string().max(2000).optional(),
    token: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    identityToken: z.string().min(20).max(4096).optional(),
});
export const patchInput = z
    .object({
        status: z.enum(["open", "snoozed", "closed"]).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        recordId: z.number().int().positive().nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
        priority: z.boolean().optional(),
    })
    .strict();
export const conversationFiltersInput = z.object({
    q: z.string().trim().max(200).default(""),
    status: z.enum(["open", "snoozed", "closed"]).optional(),
    filter: z
        .enum(["all", "mine", "unassigned", "unread", "priority"])
        .default("all"),
});
export type ConversationFilters = z.infer<typeof conversationFiltersInput>;
export function readConversationFilters(params: URLSearchParams) {
    return conversationFiltersInput.parse(
        Object.fromEntries(
            ["q", "status", "filter"].flatMap((key) =>
                params.has(key) ? [[key, params.get(key)]] : [],
            ),
        ),
    );
}
export function normalizeOrigins(raw: string[]): string[] {
    return [
        ...new Set(
            raw.map((value) => {
                const u = new URL(value.trim());
                if (
                    !["https:", "http:"].includes(u.protocol) ||
                    u.username ||
                    u.password ||
                    u.search ||
                    u.hash ||
                    u.pathname !== "/"
                )
                    throw new Error(
                        "설치 도메인을 https://example.com 형식으로 입력해주세요.",
                    );
                if (
                    u.protocol === "http:" &&
                    !["localhost", "127.0.0.1"].includes(u.hostname)
                )
                    throw new Error("설치 도메인은 HTTPS를 사용해주세요.");
                return u.origin;
            }),
        ),
    ];
}
export const channelInput = z
    .object({
        workspaceId: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
        greeting: z.string().trim().min(1).max(1000),
        color: z.string().regex(/^#[a-fA-F0-9]{6}$/),
        allowedOrigins: z
            .array(z.string().max(250))
            .max(20)
            .transform((values, ctx) => {
                try {
                    return normalizeOrigins(values);
                } catch {
                    ctx.addIssue({
                        code: "custom",
                        message:
                            "설치 도메인을 https://example.com 형식으로 입력해주세요.",
                    });
                    return z.NEVER;
                }
            }),
        enabled: z.boolean(),
    })
    .refine(
        (v) => !v.enabled || v.allowedOrigins.length > 0,
        "상담창을 켜려면 설치 도메인을 등록해주세요.",
    );
export function safePageUrl(
    value: string | undefined,
    origins: string[],
): string | null {
    try {
        const url = new URL(value ?? "");
        if (!origins.includes(url.origin)) return null;
        // 유입 경로만 저장. 쿼리에 포함될 수 있는 이메일/인증정보는 저장하지 않는다.
        return url.origin + url.pathname;
    } catch {
        return null;
    }
}
export function visitorMessage<T extends { kind: string }>(messages: T[]): T[] {
    return messages.filter((message) => message.kind !== "note");
}
export function sameRequestOrigin(origin: string, expected: string): boolean {
    const normalize = (raw: string) => {
        const url = new URL(raw);
        if (["127.0.0.1", "[::1]"].includes(url.hostname))
            url.hostname = "localhost";
        return url.origin;
    };
    try {
        return normalize(origin) === normalize(expected);
    } catch {
        return false;
    }
}
