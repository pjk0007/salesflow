import { z } from "zod";
import { messengerSettingsSchema } from "@/lib/customer-messenger/rules";
import { emailReplySelection } from "@/lib/inbox-email/recipients";
import { mentionIdsInput } from "@/lib/inbox-collaboration/rules";
import { replyGuardContext } from "@/lib/inbox-reply-guard/rules";

export const messageInput = z
    .object({
        clientId: z.string().uuid(),
        body: z
            .string()
            .trim()
            .max(5000, "메시지는 5,000자까지 입력할 수 있습니다."),
        attachmentIds: z
            .array(z.string().uuid())
            .max(5, "파일은 한 번에 5개까지 보낼 수 있습니다.")
            .default([]),
    })
    .refine(
        (v) => !!v.body || v.attachmentIds.length > 0,
        "메시지 또는 파일을 입력해주세요.",
    )
    .refine(
        (v) => new Set(v.attachmentIds).size === v.attachmentIds.length,
        "첨부 파일이 중복되었습니다.",
    );
export const replyInput = messageInput
    .safeExtend({
        kind: z.enum(["reply", "note"]),
        aiDraftId: z.string().uuid().optional(),
        emailReply: emailReplySelection.optional(),
        mentionedUserIds: mentionIdsInput.default([]),
        replyGuard: replyGuardContext.optional(),
    })
    .refine(
        (v) => !v.aiDraftId || v.kind === "reply",
        "AI 초안은 고객 답변에만 연결할 수 있습니다.",
    )
    .refine(
        (v) => !v.mentionedUserIds.length || v.kind === "note",
        "팀원 멘션은 내부 메모에서만 사용할 수 있습니다.",
    )
    .refine(
        (v) => !v.replyGuard || v.kind === "reply",
        "답변 잠금은 고객 답변에서만 사용할 수 있습니다.",
    );
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
        teamId: z.string().uuid().nullable().optional(),
        recordId: z.number().int().positive().nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
        priority: z.boolean().optional(),
        version: z.number().int().positive().optional(),
        aiState: z.enum(["auto", "human"]).optional(),
    })
    .strict();
export const conversationFiltersInput = z.object({
    q: z.string().trim().max(200).default(""),
    status: z.enum(["open", "snoozed", "closed"]).optional(),
    filter: z
        .enum([
            "all",
            "mine",
            "unassigned",
            "unread",
            "priority",
            "history",
            "mentioned",
            "myTeams",
        ])
        .default("all"),
    teamId: z
        .union([z.string().uuid(), z.literal("none"), z.literal("")])
        .default(""),
});
export type ConversationFilters = z.infer<typeof conversationFiltersInput>;
export function readConversationFilters(params: URLSearchParams) {
    return conversationFiltersInput.parse(
        Object.fromEntries(
            ["q", "status", "filter", "teamId"].flatMap((key) =>
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
        messengerSettings: messengerSettingsSchema.optional(),
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

export function sameApplicationOrigin(
    origin: string,
    requestOrigin: string,
    configuredAppUrl: string | undefined,
): boolean {
    // HTTPS 프록시 뒤의 NextRequest는 내부 HTTP 주소일 수 있다.
    // 전달 헤더가 아니라 배포 설정의 공개 주소를 기준으로 비교한다.
    if (!configuredAppUrl) return sameRequestOrigin(origin, requestOrigin);
    try {
        const app = new URL(configuredAppUrl);
        if (
            !["http:", "https:"].includes(app.protocol) ||
            app.username ||
            app.password
        )
            return false;
        return sameRequestOrigin(origin, app.origin);
    } catch {
        return false;
    }
}
