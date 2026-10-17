import { isIP } from "node:net";
import { z } from "zod";
import { fingerprint } from "@/lib/customer-imports/rules";
import { fileName } from "@/lib/inbox/file-metadata";
import { MAX_ARCHIVE_FILE_BYTES } from "@/lib/inbox-archive-storage/store";

export function sourceFileUrl(value: string) {
    const url = new URL(value);
    if (
        value.length > 8192 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        (url.port && url.port !== "443") ||
        isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") ||
        /(^|\.)(localhost|local|internal)$/.test(url.hostname)
    )
        throw new Error("공개 HTTPS 파일 주소를 입력해주세요.");
    return url.href;
}
const archiveIdentity = {
    id: z.string().uuid(), version: z.number().int().positive(),
    size: z.number().int().positive().max(MAX_ARCHIVE_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
export const fileAction = z.discriminatedUnion("action", [
    z.object({ action: z.literal("archive_plan"), ...archiveIdentity }).strict(),
    z.object({ action: z.literal("archive_attach"), ...archiveIdentity }).strict(),
    z
        .object({
            action: z.literal("prepare"),
            offset: z.number().int().min(0).default(0),
        })
        .strict(),
    z
        .object({
            action: z.literal("fetch"),
            id: z.string().uuid(),
            version: z.number().int().positive(),
        })
        .strict(),
    z
        .object({
            action: z.literal("source"),
            id: z.string().uuid(),
            version: z.number().int().positive(),
            url: z
                .string()
                .max(8192)
                .transform((v, ctx) => {
                    try {
                        return sourceFileUrl(v);
                    } catch {
                        ctx.addIssue({
                            code: "custom",
                            message: "공개 HTTPS 파일 주소를 입력해주세요.",
                        });
                        return z.NEVER;
                    }
                }),
        })
        .strict(),
]);
export function fileDescriptors(raw: unknown, maxBytes = MAX_ARCHIVE_FILE_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARCHIVE_FILE_BYTES) throw new Error("잘못된 파일 크기 한도입니다.");
    const seen = new Map<string, number>();
    return (Array.isArray(raw) ? raw : []).map(
        (file: Record<string, unknown>, index) => {
            const originalId = String(file.id ?? file.key ?? index),
                occurrence = seen.get(originalId) ?? 0;
            seen.set(originalId, occurrence + 1);
            const sizeValue = file.size ?? file.filesize,
                size =
                    sizeValue === undefined || sizeValue === null
                        ? null
                        : Number(sizeValue),
                sha =
                    typeof file.sha256 === "string"
                        ? file.sha256.toLowerCase()
                        : null,
                name = fileName(String(file.name ?? file.fileName ?? "파일")),
                validSize =
                    size === null ||
                    ((typeof sizeValue === "number" ||
                        typeof sizeValue === "string") &&
                        Number.isSafeInteger(size) &&
                        size >= 1 &&
                        size <= maxBytes),
                validHash =
                    file.sha256 === undefined ||
                    file.sha256 === null ||
                    (sha !== null && /^[a-f0-9]{64}$/.test(sha)),
                manifest = fingerprint({
                    originalId,
                    name,
                    size,
                    sha,
                    invalidSizeInput: validSize ? null : sizeValue,
                    invalidHashInput: validHash ? null : file.sha256,
                    type:
                        file.contentType ??
                        file.content_type ??
                        file.type ??
                        null,
                }),
                sourceKey = fingerprint([originalId, occurrence]);
            let url: string | null = null;
            try {
                url = sourceFileUrl(
                    String(
                        file.url ?? file.downloadUrl ?? file.download_url ?? "",
                    ),
                );
            } catch {
                /* A provider key alone needs a fresh signed URL. */
            }
            return {
                index,
                sourceKey,
                manifest,
                name,
                size,
                sha,
                url,
                locator: {
                    originalId,
                    key: typeof file.key === "string" ? file.key : null,
                    index,
                },
                invalid: !validSize || !validHash,
            };
        },
    );
}
