import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EsignService } from "./core";
import type { EsignDelivery } from "./delivery";
import type { EsignStorage } from "./storage";
import { artifactHash } from "./storage";
import { inspectPdfInWorker } from "./pdf-worker";
import { readEsignRendererAsset } from "./assets";
import { EsignError, type EsignActor, type EsignRecipientInput, type EsignValue } from "./types";
import type { EsignAlimtalkStatus } from "./alimtalk";

export type EsignEngine = { service: EsignService; storage: EsignStorage; delivery: EsignDelivery; kick(): Promise<void> };
export type EsignHttpDependencies = {
    engine(): Promise<EsignEngine>;
    authorize(request: Request, workspaceId: number, capability: "read" | "respond"): Promise<EsignActor>;
    status(request: Request): Promise<{ enabled: boolean; emailReady: boolean; smsReady: boolean; alimtalkReady?: boolean; alimtalk?: EsignAlimtalkStatus; databaseReady: boolean; storageReady: boolean; issues: string[] }>;
    prefill(request: Request, actor: EsignActor, params: URLSearchParams): Promise<EsignRecipientInput>;
};
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const result = (data: unknown, status = 200) => Response.json({ success: true, data }, { status, headers: HEADERS });
function fail(error: unknown) {
    if (error instanceof EsignError) return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: HEADERS });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ success: false, error: "입력 내용을 확인해주세요." }, { status: 400, headers: HEADERS });
    return Response.json({ success: false, error: "전자서명 요청을 처리하지 못했습니다. 잠시 후 다시 확인해주세요." }, { status: 503, headers: HEADERS });
}
async function boundedBody(request: Request, max = 11 * 1024 * 1024) {
    const claimed = request.headers.get("content-length");
    if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > max)) throw new EsignError("요청 파일과 입력 크기가 너무 큽니다.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new EsignError("입력 내용이 필요합니다.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new EsignError("요청 파일과 입력 크기가 너무 큽니다.", 413); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
}
const jsonBody = async (request: Request) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(request)));
function fileResponse(bytes: Uint8Array, filename: string, contentType = "application/pdf") {
    return new Response(Buffer.from(bytes), { headers: { ...HEADERS, "Content-Type": contentType, "Content-Length": String(bytes.byteLength), "Content-Disposition": `inline; filename="contract.${contentType === "application/pdf" ? "pdf" : "json"}"; filename*=UTF-8''${encodeURIComponent(filename)}`, "Content-Security-Policy": "sandbox" } });
}
function requireWorkspace(url: URL, body?: { workspaceId?: unknown }) {
    const raw = url.searchParams.get("workspaceId") ?? body?.workspaceId;
    const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(id) || id < 1) throw new EsignError("사업을 선택해주세요.");
    return id;
}
const kick = (engine: EsignEngine) => { void engine.kick().catch(() => undefined); };

/** Shared Request/Response handler is exercised through the isolated test HTTP server too. */
export async function handleEsignRequest(request: Request, dependencies: EsignHttpDependencies): Promise<Response> {
    try {
        const url = new URL(request.url), route = url.pathname.replace(/^\/api\/esign\/?/, "").split("/").filter(Boolean), method = request.method;
        if (route[0] === "assets" && method === "GET" && route.length === 4) return await readEsignRendererAsset(route[1], route[2], route[3]);
        if (route[0] === "status" && method === "GET") return result(await dependencies.status(request));
        const engine = await dependencies.engine(), { service, storage, delivery } = engine;
        if (route[0] === "public") {
            const token = route[1], action = route[2];
            if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404);
            const verification = request.headers.get("X-Esign-Verification") ?? undefined;
            if (!action && method === "GET") return result(await service.publicSession(token, verification));
            if (action === "document" && method === "GET") {
                const session = await service.publicSession(token, verification);
                if (!session.verified || !session.document) throw new EsignError("확인 코드를 먼저 입력해주세요.", 401);
                const final = url.searchParams.get("final") === "1";
                const artifact = final ? session.finalArtifact : session.document.artifact;
                if (!artifact || (final && session.envelope.state !== "completed")) throw new EsignError("완료 문서가 아직 준비되지 않았습니다.", 409);
                return fileResponse(await storage.get(artifact), `${session.envelope.title}${final ? "-완료" : ""}.pdf`);
            }
            if (action === "audit" && method === "GET") {
                const session = await service.publicSession(token, verification);
                if (!session.verified || session.envelope.state !== "completed") throw new EsignError("본인 확인과 문서 완료 후 확인 기록을 내려받을 수 있습니다.", 401);
                const aggregate = await service.repository.read(session.envelope.id);
                if (!aggregate) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404);
                const own = aggregate.recipients.find(r => r.id === session.recipient.id)!;
                const audit = { id: session.envelope.id, title: session.envelope.title, sourceSha256: aggregate.envelope.document.artifact.sha256, finalSha256: aggregate.envelope.finalArtifact?.sha256, completedAt: aggregate.envelope.completedAt, recipient: { name: own.name, consentAt: own.consentAt, signedAt: own.signedAt }, events: aggregate.events.filter(e => e.recipientId === own.id || e.type === "envelope.completed").map(e => ({ type: e.type, at: e.at })) };
                return fileResponse(Buffer.from(JSON.stringify(audit, null, 2)), `${session.envelope.title}-확인기록.json`, "application/json");
            }
            if (method !== "POST") throw new EsignError("요청 경로를 찾을 수 없습니다.", 404);
            const body = await jsonBody(request);
            if (action === "otp") {
                const channel = z.enum(["email", "alimtalk", "sms"]).parse(body.channel), session = await service.publicSession(token);
                const aggregate = await service.repository.read(session.envelope.id);
                if (!aggregate || !await delivery.ready(channel, aggregate.envelope.orgId)) throw new EsignError(`${channel === "alimtalk" ? "알림톡 템플릿 승인과 연결" : channel === "sms" ? "SMS 발송 설정" : "이메일 발송 설정"}이 준비되지 않았습니다. 요청자에게 문의해주세요.`, 503, "delivery_unconfigured");
                const queued = await service.requestOtp(token, channel); kick(engine);
                return result(queued);
            }
            if (action === "verify") return result(await service.verifyOtp(token, z.string().regex(/^\d{6}$/).parse(body.code)));
            if (action === "sign") {
                const verificationToken = z.string().min(40).max(128).parse(body.verificationToken);
                if (body.action === "reject") {
                    await service.reject(token, { verificationToken, reason: z.string().max(300).optional().parse(body.reason) });
                    return result(await service.publicSession(token, verificationToken));
                }
                const input = z.object({ verificationToken: z.string(), consent: z.literal(true), idempotencyKey: z.string().min(8).max(200), values: z.array(z.object({ fieldId: z.string().min(1).max(100), text: z.string().max(1000).optional(), pngDataUrl: z.string().max(1_500_000) }).strict()).min(1).max(150) }).strict().parse(body);
                const session = await service.publicSession(token, verificationToken);
                if (!session.verified || !session.document) throw new EsignError("확인 코드를 먼저 입력해주세요.", 401);
                const ownFields = new Set(session.document.fields.filter(f => f.recipientIndex === session.recipient.index).map(f => f.id));
                if (new Set(input.values.map(v => v.fieldId)).size !== input.values.length || input.values.some(v => !ownFields.has(v.fieldId))) throw new EsignError("본인의 입력란만 서명할 수 있습니다.");
                const { validateSignaturePng } = await import("./pdf");
                let totalBytes = 0, totalPixels = 0;
                const prepared = input.values.map(value => {
                    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.pngDataUrl)) throw new EsignError("PNG 서명 이미지를 확인해주세요.");
                    const bytes = Buffer.from(value.pngDataUrl.slice("data:image/png;base64,".length), "base64");
                    const { width, height } = validateSignaturePng(bytes); totalBytes += bytes.length; totalPixels += width * height;
                    if (totalBytes > 8 * 1024 * 1024 || totalPixels > 8_000_000) throw new EsignError("입력한 서명 이미지가 너무 큽니다.", 413);
                    return { value, bytes, raster: { width, height } };
                });
                const values: EsignValue[] = [];
                for (const { value, bytes, raster } of prepared) {
                    const key = `esign/signatures/${session.envelope.id}/${session.recipient.id}/${artifactHash(bytes)}.png`;
                    values.push({ fieldId: value.fieldId, ...(value.text !== undefined ? { text: value.text } : {}), raster, artifact: await storage.put(key, bytes, "image/png") });
                }
                await service.submitSignature(token, { verificationToken, idempotencyKey: input.idempotencyKey, consent: true, values }); kick(engine);
                return result(await service.publicSession(token, verificationToken));
            }
            throw new EsignError("요청 경로를 찾을 수 없습니다.", 404);
        }

        let body: Record<string, unknown> | undefined;
        let form: FormData | undefined;
        if (method !== "GET") {
            if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
                const bytes = await boundedBody(request);
                form = await new Request(request.url, { method: "POST", headers: request.headers, body: bytes }).formData();
                body = { workspaceId: form.get("workspaceId") };
            } else body = await jsonBody(request);
        }
        const workspaceId = requireWorkspace(url, body), actor = await dependencies.authorize(request, workspaceId, method === "GET" ? "read" : "respond");
        if (route[0] === "prefill" && method === "GET") return result(await dependencies.prefill(request, actor, url.searchParams));
        if (route[0] === "documents") {
            const id = route[1], action = route[2];
            if (!id && method === "GET") return result(await service.repository.documents(actor));
            if (!id && method === "POST") {
                if (form) {
                    const file = form.get("file");
                    if (!(file instanceof File) || !/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024) throw new EsignError("10MB 이하의 PDF 파일을 올려주세요.");
                    const bytes = new Uint8Array(await file.arrayBuffer()), inspected = await inspectPdfInWorker(bytes);
                    const artifact = await storage.put(`esign/documents/${randomUUID()}/source.pdf`, bytes, "application/pdf");
                    return result(await service.createDocument(actor, { title: z.string().parse(form.get("title")), kind: z.enum(["document", "template"]).parse(form.get("kind")), artifact, pages: inspected.pages, fields: [] }), 201);
                }
                const clone = z.object({ sourceDocumentId: z.string().uuid(), title: z.string(), kind: z.enum(["document", "template"]), fields: z.array(z.unknown()) }).strict().parse(body);
                const source = await service.getDocument(actor, clone.sourceDocumentId);
                return result(await service.createDocument(actor, { artifact: source.artifact, pages: source.pages, title: clone.title, kind: clone.kind, fields: clone.fields as typeof source.fields }), 201);
            }
            if (id && !action && method === "GET") return result(await service.getDocument(actor, id));
            if (id && !action && method === "PATCH") return result(await service.updateDocument(actor, id, z.object({ title: z.string().optional(), kind: z.enum(["document", "template"]).optional(), fields: z.array(z.unknown()).optional(), version: z.number().int().positive() }).strict().parse(body) as Parameters<EsignService["updateDocument"]>[2]));
            if (id && action === "file" && method === "GET") { const doc = await service.getDocument(actor, id); return fileResponse(await storage.get(doc.artifact), `${doc.title}.pdf`); }
        }
        if (route[0] === "envelopes") {
            const id = route[1], action = route[2];
            if (!id && method === "GET") return result(await service.listEnvelopes(actor));
            if (!id && method === "POST") {
                const input = body as unknown as Parameters<EsignService["createEnvelope"]>[1];
                const recipients = z.array(z.object({ channels: z.array(z.enum(["email", "alimtalk", "sms"])) }).passthrough()).min(1).max(5).parse(input?.recipients);
                for (const channel of new Set(recipients.flatMap(r => r.channels))) if (!await delivery.ready(channel, actor.orgId)) throw new EsignError(channel === "alimtalk" ? "알림톡 연결과 전자서명 템플릿 3종 승인을 먼저 완료해주세요." : `${channel === "sms" ? "SMS" : "이메일"} 발송 설정을 먼저 완료해주세요.`, 503, "delivery_unconfigured");
                const created = await service.createEnvelope(actor, input);
                const detail = await service.dispatchEnvelope(actor, created.envelope.id); kick(engine); return result(detail, 201);
            }
            if (id && !action && method === "GET") return result(await service.getEnvelope(actor, id));
            if (id && action === "action" && method === "POST") {
                const input = z.object({ action: z.enum(["cancel", "retry_finalize"]) }).strict().parse(body);
                if (input.action === "cancel") return result(await service.cancelEnvelope(actor, id));
                const detail = await service.retryFinalization(actor, id);
                kick(engine); return result(detail);
            }
            if (id && action === "file" && method === "GET") {
                const detail = await service.getEnvelope(actor, id), final = url.searchParams.get("final") === "1";
                const artifact = final ? detail.envelope.finalArtifact : detail.envelope.document.artifact;
                if (!artifact || (final && detail.envelope.state !== "completed")) throw new EsignError("완료 문서가 아직 준비되지 않았습니다.", 409);
                return fileResponse(await storage.get(artifact), `${detail.envelope.title}${final ? "-완료" : ""}.pdf`);
            }
            if (id && action === "audit" && method === "GET") {
                const detail = await service.getEnvelope(actor, id);
                return fileResponse(Buffer.from(JSON.stringify({ id: detail.envelope.id, title: detail.envelope.title, state: detail.envelope.state, sourceSha256: detail.envelope.document.artifact.sha256, finalSha256: detail.envelope.finalArtifact?.sha256, recipients: detail.recipients.map(r => ({ name: r.name, signedAt: r.signedAt, consentAt: r.consentAt })), events: detail.events }, null, 2)), `${detail.envelope.title}-확인기록.json`, "application/json");
            }
        }
        throw new EsignError("요청 경로를 찾을 수 없습니다.", 404);
    } catch (error) { return fail(error); }
}
