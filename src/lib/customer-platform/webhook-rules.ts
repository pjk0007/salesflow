import { isIP } from "node:net";
import { z } from "zod";
export const webhookEventTypes = [
    "contact.created",
    "contact.updated",
    "company.created",
    "company.updated",
    "customer.event",
    "conversation.created",
    "conversation.updated",
    "message.created",
    "deal.created",
    "deal.updated",
    "task.created",
    "task.updated",
    "pipeline.created",
    "pipeline.updated",
    "platform.test",
] as const;
export function webhookUrl(value: string) {
    const url = new URL(value);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        (url.port && url.port !== "443") ||
        isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") ||
        /(^|\.)(localhost|local|internal)$/.test(url.hostname)
    )
        throw new Error(
            "공개 HTTPS 수신 주소를 입력해주세요. 쿼리·계정 정보·IP 주소는 사용할 수 없습니다.",
        );
    return url.href;
}
const urlInput = z
    .string()
    .max(2000)
    .transform((value, ctx) => {
        try {
            return webhookUrl(value);
        } catch {
            ctx.addIssue({
                code: "custom",
                message:
                    "공개 HTTPS 수신 주소를 입력해주세요. 쿼리·계정 정보·IP 주소는 사용할 수 없습니다.",
            });
            return z.NEVER;
        }
    });
export const webhookCreate = z
    .object({
        workspaceId: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
        url: urlInput,
        eventTypes: z
            .array(z.enum(webhookEventTypes))
            .min(1)
            .max(30)
            .transform((v) => [...new Set(v)].sort()),
    })
    .strict();
export const webhookPatch = webhookCreate
    .omit({ workspaceId: true })
    .partial()
    .extend({
        version: z.number().int().positive(),
        enabled: z.boolean().optional(),
    })
    .strict();
export function publicAddress(address: string) {
    const family = isIP(address);
    if (family === 4) {
        const p = address.split(".").map(Number),
            [a, b, c] = p;
        return !(
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 &&
                (b === 168 ||
                    (b === 0 && (c === 0 || c === 2)) ||
                    (b === 88 && c === 99))) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113)
        );
    }
    if (family === 6) {
        const [first, second] = address
            .toLowerCase()
            .split(":")
            .map((v) => parseInt(v || "0", 16));
        return (
            first >= 0x2000 &&
            first <= 0x3fff &&
            first !== 0x2002 &&
            !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) &&
            !(first === 0x3fff && second <= 0xfff)
        );
    }
    return false;
}
export function retryDelay(
    attempt: number,
    retryAfter: string | null,
    now: Date,
) {
    const base = [60000, 300000, 900000, 3600000, 10800000, 21600000, 43200000][
        Math.min(6, Math.max(0, attempt - 1))
    ];
    const hint = retryAfter
        ? /^\d+$/.test(retryAfter.trim())
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - now.getTime()
        : 0;
    return Math.min(86400000, Math.max(base, Number.isFinite(hint) ? hint : 0));
}
