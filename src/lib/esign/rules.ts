import { z } from "zod";
import { EsignError, type EsignArtifact, type EsignDocumentInput, type EsignEnvelopeInput, type EsignRecipient, type EsignEnvelope, type EsignValue } from "./types";
import { ESIGN_PDF_LIMITS } from "./pdf-types";
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_COOLDOWN_MS = 60 * 1000;
export const VERIFY_TTL_MS = 30 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
const artifact = z.object({ key: z.string().min(1).max(600), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(10 * 1024 * 1024), contentType: z.enum(["application/pdf", "image/png"]) }).strict();
export const artifactInput = artifact;
const imageArtifactInput = artifact.extend({ size: z.number().int().min(1).max(ESIGN_PDF_LIMITS.pngBytes), contentType: z.literal("image/png") });
const rasterInput = z.object({ width: z.number().int().positive().max(ESIGN_PDF_LIMITS.pngDimension), height: z.number().int().positive().max(ESIGN_PDF_LIMITS.pngDimension) }).strict().refine((r) => r.width * r.height <= ESIGN_PDF_LIMITS.pngPixels, "서명 이미지의 픽셀 수가 한도를 넘었습니다.");
const field = z.object({
    id: z.string().min(1).max(100), recipientIndex: z.number().int().min(0).max(4), type: z.enum(["signature", "seal", "name", "date", "text"]),
    pageIndex: z.number().int().min(0).max(29), x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1), height: z.number().gt(0).max(1), required: z.boolean(), label: z.string().max(100).optional(),
}).strict().refine((f) => f.x + f.width <= 1.00000001 && f.y + f.height <= 1.00000001, "입력란이 페이지 밖에 있습니다.");
const page = z.object({ pageIndex: z.number().int().min(0).max(29), width: z.number().positive().max(14400), height: z.number().positive().max(14400), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), crop: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }) });
export const documentInput = z.object({ title: z.string().trim().min(1).max(200), kind: z.enum(["document", "template"]), artifact, pages: z.array(page).min(1).max(30), fields: z.array(field).max(100) }).strict();
export const envelopeInput = z.object({
    documentId: z.string().uuid(), title: z.string().trim().min(1).max(200), order: z.enum(["parallel", "sequential"]), expiresAt: z.string().datetime({ offset: true }),
    recipients: z.array(z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254).optional(), phone: z.string().trim().regex(/^\+?[0-9 -]{8,25}$/).optional(), channels: z.array(z.enum(["email", "alimtalk", "sms"])).min(1).max(3), contactId: z.string().uuid().optional(), recordId: z.number().int().positive().optional() }).strict()).min(1).max(5),
}).strict();
export function parseDocument(raw: EsignDocumentInput) {
    const input = documentInput.parse(raw);
    if (input.artifact.contentType !== "application/pdf") throw new EsignError("PDF 문서를 선택해주세요.");
    if (new Set(input.fields.map((f) => f.id)).size !== input.fields.length) throw new EsignError("입력란 번호가 중복되었습니다.");
    if (input.pages.some((p, i) => p.pageIndex !== i) || input.fields.some((f) => f.pageIndex >= input.pages.length)) throw new EsignError("페이지 번호를 확인해주세요.");
    return input;
}
export function parseEnvelope(raw: EsignEnvelopeInput, now: Date) {
    const input = envelopeInput.parse(raw), expires = new Date(input.expiresAt).getTime();
    if (expires <= now.getTime() || expires > now.getTime() + 90 * 86400000) throw new EsignError("만료일은 현재 이후 90일 이내로 선택해주세요.");
    for (const r of input.recipients) {
        if (new Set(r.channels).size !== r.channels.length) throw new EsignError("발송 채널이 중복되었습니다.");
        if (r.channels.includes("email") && !r.email) throw new EsignError("이메일 수신자의 주소를 입력해주세요.");
        if (r.phone) r.phone = r.phone.replace(/[ -]/g, "");
        if (r.channels.includes("sms") || r.channels.includes("alimtalk")) {
            // Both NHN domestic transports expect a national number, not an E.164 +82 prefix.
            if (r.phone) r.phone = r.phone.replace(/^\+820?/, "0");
            if (!r.phone || !/^01[016789]\d{7,8}$/.test(r.phone))
                throw new EsignError("알림톡·SMS는 국내 휴대폰 번호만 지원합니다. 010 형식의 번호를 입력해주세요.");
        }
    }
    return input;
}
export function activeEnvelope(envelope: EsignEnvelope, now: Date) {
    if (new Date(envelope.expiresAt) <= now) throw new EsignError("서명 요청이 만료되었습니다.", 410, "expired");
    if (envelope.state !== "pending") throw new EsignError("현재는 서명할 수 없는 요청입니다.", 409, envelope.state);
}
export function recipientWaiting(envelope: EsignEnvelope, recipients: EsignRecipient[], recipient: EsignRecipient) {
    return envelope.order === "sequential" && recipients.some((r) => r.index < recipient.index && r.state !== "signed");
}
export function validateValues(fields: EsignDocumentInput["fields"], recipientIndex: number, raw: EsignValue[]) {
    const values = z.array(z.object({ fieldId: z.string().min(1).max(100), text: z.string().trim().max(2000).optional(), artifact: imageArtifactInput, raster: rasterInput }).strict()).max(100).parse(raw);
    if (new Set(values.map((v) => v.fieldId)).size !== values.length) throw new EsignError("입력란이 중복되었습니다.");
    for (const value of values) {
        const f = fields.find((f) => f.id === value.fieldId && f.recipientIndex === recipientIndex);
        if (!f) throw new EsignError("다른 서명자의 입력란은 작성할 수 없습니다.", 403);
        if (f.type === "signature" || f.type === "seal") {
            if (!value.artifact || value.artifact.contentType !== "image/png" || value.text) throw new EsignError("서명 또는 도장 이미지를 입력해주세요.");
        } else if (!value.text) throw new EsignError("입력란을 작성해주세요.");
        if (f.type === "date") {
            const date = new Date(`${value.text}T00:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value.text ?? "") || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.text)
                throw new EsignError("올바른 YYYY-MM-DD 날짜를 입력해주세요.");
        }
    }
    if (fields.some((f) => f.recipientIndex === recipientIndex && f.required && !values.some((v) => v.fieldId === f.id))) throw new EsignError("필수 입력란을 모두 작성해주세요.");
    return values;
}
/** Metadata comes from the server's PNG decoder; deduplicate the whole envelope by its content hash. */
export function uniqueImageBudget(values: EsignValue[]) {
    const unique = new Map<string, { size: number; width: number; height: number }>();
    for (const value of values) {
        if (!value.artifact) continue;
        const image = imageArtifactInput.parse(value.artifact), raster = rasterInput.parse(value.raster);
        const previous = unique.get(image.sha256);
        if (previous && (previous.size !== image.size || previous.width !== raster.width || previous.height !== raster.height))
            throw new EsignError("같은 서명 이미지의 크기 정보가 일치하지 않습니다.", 400, "image_metadata_mismatch");
        unique.set(image.sha256, { size: image.size, ...raster });
    }
    return [...unique.values()].reduce((sum, image) => ({ bytes: sum.bytes + image.size, pixels: sum.pixels + image.width * image.height }), { bytes: 0, pixels: 0 });
}
export function assertImageOwnership(artifact: EsignArtifact, envelopeId: string, recipientId: string) {
    if (!artifact.key.startsWith(`esign/signatures/${envelopeId}/${recipientId}/`)) throw new EsignError("현재 서명자의 이미지가 아닙니다.", 403);
}
export function maskEmail(value?: string) { return value ? value.replace(/^(.{1})([^@]*)(@.*)$/, "$1***$3") : undefined; }
export function maskPhone(value?: string) { return value ? `${value.slice(0, 3)}****${value.slice(-4)}` : undefined; }
