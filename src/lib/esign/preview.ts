import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EsignService } from "./core";
import { MemoryEsignRepository } from "./memory-repository";
import { createEsignStorage, artifactHash } from "./storage";
import { inspectPdfInWorker } from "./pdf-worker";
import { createEsignJobRunner } from "./worker";
import { handleEsignRequest, type EsignHttpDependencies } from "./http";
import { EsignError, type DeliveryPayload, type EsignActor, type EsignDocumentInput, type EsignEnvelopeInput, type EsignJob, type EsignChannel } from "./types";

export type PreviewMessage = { id: string; envelopeId: string; kind: string; channel?: EsignChannel; name?: string; title?: string; signUrl?: string; code?: string; createdAt: string };
const fakeRecipient = (input: { email?: string; phone?: string }) =>
    (!input.email || /^[^@]+@[^@]+\.example\.test$/.test(input.email)) && (!input.phone || /^01000000\d{3}$/.test(input.phone));

/** No DB, customer lookup, configured secrets, or network delivery exists in this runtime. */
export async function createEsignPreviewRuntime(pdfBytes: Uint8Array) {
    const repository = new MemoryEsignRepository(), blobs = new Map<string, Uint8Array>();
    const secret = randomBytes(48).toString("base64url");
    let storedBytes = 0, documents = 0, envelopes = 0;
    const storage = createEsignStorage({
        async putOnce(key, bytes) {
            if (blobs.has(key)) return false;
            if (storedBytes + bytes.length > 24 * 1024 * 1024) throw new EsignError("체험 저장 한도에 도달했습니다. 개발 서버를 재시작하면 초기화됩니다.", 413);
            blobs.set(key, Uint8Array.from(bytes)); storedBytes += bytes.length; return true;
        },
        async read(key) { const value = blobs.get(key); if (!value) throw new EsignError("체험 파일이 초기화되었습니다. 새 예시로 시작해주세요.", 404); return Uint8Array.from(value); },
    }, secret);
    const hash = artifactHash(pdfBytes), pages = (await inspectPdfInWorker(pdfBytes)).pages;
    class PreviewService extends EsignService {
        override async createDocument(actor: EsignActor, input: EsignDocumentInput) {
            if (input.artifact.sha256 !== hash) throw new EsignError("체험에서는 준비된 가상 계약서 템플릿만 사용해주세요.");
            if (documents >= 80) throw new EsignError("체험 문서 한도에 도달했습니다.", 429);
            documents++;
            try { return await super.createDocument(actor, input); } catch (error) { documents--; throw error; }
        }
        override async createEnvelope(actor: EsignActor, input: EsignEnvelopeInput) {
            if (!Array.isArray(input.recipients) || !input.recipients.every(fakeRecipient)) throw new EsignError("체험은 @isolated.example.test 이메일과 01000000xxx 가상 번호만 사용할 수 있습니다.");
            if (envelopes >= 40) throw new EsignError("체험 요청 한도에 도달했습니다.", 429);
            envelopes++;
            try { return await super.createEnvelope(actor, input); } catch (error) { envelopes--; throw error; }
        }
    }
    const service = new PreviewService({ repository, secret });
    const captured: { message: PreviewMessage; payload: DeliveryPayload; recipientId?: string }[] = [];
    const delivery = {
        async ready() { return true; },
        async send(job: EsignJob, _orgId: string, payload: DeliveryPayload) {
            if (!fakeRecipient(payload)) throw new EsignError("가상 수신자만 체험할 수 있습니다.");
            captured.push({ recipientId: job.recipientId, payload: structuredClone(payload), message: { id: job.id, envelopeId: job.envelopeId, kind: job.kind, channel: job.channel, name: payload.name, title: payload.title, ...(payload.token ? { signUrl: `/sign/${payload.token}?preview=1` } : {}), ...(payload.code ? { code: payload.code } : {}), createdAt: new Date().toISOString() } });
            return { state: "accepted" as const, providerId: "preview-" + randomUUID() };
        },
    };
    const engine = { service, storage, delivery, kick: createEsignJobRunner(service, storage, delivery) };
    const seeds = new Map<string, Promise<void>>();
    async function seed(actor: EsignActor) {
        const key = `${actor.orgId}:${actor.workspaceId}`;
        if (seeds.has(key)) return seeds.get(key)!;
        if (seeds.size >= 20) throw new EsignError("체험 공간 한도에 도달했습니다.", 429);
        const task = (async () => {
            const artifact = await storage.put("esign/preview/contract.pdf", pdfBytes, "application/pdf");
            const document = await service.createDocument(actor, { title: "한글 계약서 체험 (가상 자료)", kind: "template", artifact, pages,
                fields: [
                    { id: "preview-seal", recipientIndex: 0, type: "seal", pageIndex: 0, x: .68, y: .77, width: .17, height: .12, required: true, label: "가상 도장" },
                    { id: "preview-name", recipientIndex: 0, type: "name", pageIndex: 0, x: .2, y: .81, width: .24, height: .04, required: true, label: "가상 이름" },
                    { id: "preview-date", recipientIndex: 0, type: "date", pageIndex: 0, x: .2, y: .86, width: .24, height: .04, required: true, label: "체험 날짜" },
                ],
            });
            const detail = await service.createEnvelope(actor, { documentId: document.id, title: `${actor.workspaceId === 101 ? "디하" : "백오랩"} · 가상 계약서 서명 체험`, order: "parallel", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), recipients: [{ name: "가상 고객", email: "customer@isolated.example.test", phone: "01000000001", channels: ["email", "alimtalk"] }] });
            await service.dispatchEnvelope(actor, detail.envelope.id); await engine.kick();
        })();
        seeds.set(key, task); try { await task; } catch (error) { seeds.delete(key); throw error; }
    }
    return { engine, seed, async outbox(actor: EsignActor) {
        const ids = new Set((await service.listEnvelopes(actor)).map(item => item.envelope.id));
        return captured.filter(item => ids.has(item.message.envelopeId)).map(item => structuredClone(item.message)).slice(-100).reverse();
    },
        async codeForRecipient(token: string) {
            const session = await service.publicSession(token);
            return captured.findLast(item => item.message.envelopeId === session.envelope.id && item.message.kind === "otp" && item.recipientId === session.recipient.id)?.payload.code;
        },
    };
}
type PreviewRuntime = Awaited<ReturnType<typeof createEsignPreviewRuntime>>;
const shared = globalThis as typeof globalThis & { __sendbEsignPreview?: Promise<PreviewRuntime> };
export async function getEsignPreviewRuntime() {
    return shared.__sendbEsignPreview ??= readFile(path.join(process.cwd(), "public/dev-start/esign-contract.pdf")).then(createEsignPreviewRuntime);
}
export async function handleEsignPreviewRequest(request: Request, options: { enabled: boolean; actor(request: Request): Promise<Omit<EsignActor, "workspaceId">>; runtime?: () => Promise<PreviewRuntime> }) {
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
    const json = (data: unknown, status = 200) => Response.json({ success: true, data }, { status, headers });
    if (!options.enabled) return Response.json({ success: false, error: "체험은 샌드비 개발 서버에서만 사용할 수 있습니다." }, { status: 404, headers });
    try {
        const url = new URL(request.url), route = url.pathname.replace(/^\/api\/esign-preview\/?/, "");
        const publicRoute = route.startsWith("public/"), user = publicRoute ? undefined : await options.actor(request);
        const app = await (options.runtime ?? getEsignPreviewRuntime)();
        const authorize: EsignHttpDependencies["authorize"] = async (_request, workspaceId) => {
            if (!user || ![101, 102].includes(workspaceId)) throw new EsignError("가상 체험 사업을 선택해주세요.", 403);
            const actor = { ...user, workspaceId }; await app.seed(actor); return actor;
        };
        if (route === "outbox" && request.method === "GET") return json(await app.outbox(await authorize(request, Number(url.searchParams.get("workspaceId")), "read")));
        url.pathname = url.pathname.replace("/api/esign-preview", "/api/esign");
        const forwarded = new Request(url, request);
        const response = await handleEsignRequest(forwarded, {
            engine: async () => app.engine, authorize,
            status: async () => ({ enabled: true, emailReady: true, smsReady: true, alimtalkReady: true, alimtalk: { ready: true, channelName: "가상 체험 채널", templates: [] }, storageReady: true, databaseReady: true, issues: [] }),
            prefill: async () => ({ name: "가상 고객", email: "customer@isolated.example.test", phone: "01000000001", channels: ["email", "alimtalk"] }),
        });
        if (response.ok && request.method === "POST") {
            await app.engine.kick();
            if (/^public\/[^/]+\/otp$/.test(route)) {
                const body = await response.json(); body.data.previewCode = await app.codeForRecipient(route.split("/")[1]); return json(body.data);
            }
        }
        return response;
    } catch (error) { return Response.json({ success: false, error: error instanceof EsignError ? error.message : "체험을 준비하지 못했습니다. 다시 확인해주세요." }, { status: error instanceof EsignError ? error.status : 503, headers }); }
}
