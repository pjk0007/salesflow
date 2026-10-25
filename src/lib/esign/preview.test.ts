import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createEsignPreviewRuntime, handleEsignPreviewRequest, type PreviewMessage } from "./preview";
import { isEsignPreviewRuntime } from "./preview-config";
import { EsignError, type EsignDocument, type EsignListPage, type StaffEsignSummary } from "./types";

const actor = { orgId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", name: "가상 담당자" };
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJklEQVR4nGP8z8Dwn4GBgYFxC4hkYGCCUAjAyMDwH6xCUlIKuwoA8JQFBIK0JaYAAAAASUVORK5CYII=";
test("preview requires the exact dev deployment and explicit opt-in; disabled/anonymous requests allocate nothing", async () => {
    const origin = "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app";
    assert.equal(isEsignPreviewRuntime({ NEXT_PUBLIC_APP_URL: origin, ESIGN_PREVIEW: "on" }), true);
    for (const env of [{ NEXT_PUBLIC_APP_URL: origin }, { NEXT_PUBLIC_APP_URL: "https://sendb.kr", ESIGN_PREVIEW: "on" }, { NEXT_PUBLIC_APP_URL: origin + ".evil.test", ESIGN_PREVIEW: "on" }]) assert.equal(isEsignPreviewRuntime(env), false);
    let allocated = 0;
    const options = { enabled: false, actor: async () => { throw new EsignError("로그인이 필요합니다.", 401); }, runtime: async () => { allocated++; throw Error("must not allocate"); } };
    const request = new Request("http://localhost/api/esign-preview/status");
    assert.equal((await handleEsignPreviewRequest(request, options)).status, 404);
    assert.equal((await handleEsignPreviewRequest(request, { ...options, enabled: true })).status, 401);
    assert.equal(allocated, 0);
});
test("dev preview uses real handler/worker for seeded invitation, inline OTP, signing and final PDF, with no DB or transport", async () => {
    const app = await createEsignPreviewRuntime(await readFile("public/dev-start/esign-contract.pdf"));
    const options = { enabled: true, actor: async () => actor, runtime: async () => app };
    async function api<T>(route: string, body?: unknown, expected = 200, headers?: Record<string, string>) {
        const response = await handleEsignPreviewRequest(new Request(`http://localhost/api/esign-preview${route}`, { method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), options);
        const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data as T;
    }
    const documents = await api<EsignListPage<EsignDocument>>("/documents?workspaceId=101&kind=template");
    assert.equal(documents.items.length, 1); assert.equal(documents.total, 1); assert.equal(documents.nextCursor, null);
    const messages = await api<PreviewMessage[]>("/outbox?workspaceId=101");
    assert.equal(messages.length, 2); assert.equal(messages[0].signUrl, messages[1].signUrl);
    const token = new URL(messages[0].signUrl!, "http://localhost").pathname.split("/").at(-1)!;
    assert.deepEqual(messages.map(m => m.channel).sort(), ["alimtalk", "email"]);
    const code = await api<{ previewCode: string }>(`/public/${token}/otp`, { channel: "alimtalk" }); assert.match(code.previewCode, /^\d{6}$/);
    const verification = await api<{ verificationToken: string }>(`/public/${token}/verify`, { code: code.previewCode });
    await api(`/public/${token}/sign`, { verificationToken: verification.verificationToken, idempotencyKey: "preview-full-flow", consent: true, values: documents.items[0].fields.map(f => ({ fieldId: f.id, pngDataUrl: png, ...(f.type === "name" ? { text: "가상 고객" } : f.type === "date" ? { text: "2026-10-18" } : {}) })) });
    await app.engine.kick();
    const details = (await api<EsignListPage<StaffEsignSummary>>("/envelopes?workspaceId=101")).items; assert.equal(details[0].envelope.state, "completed");
    const download = await handleEsignPreviewRequest(new Request(`http://localhost/api/esign-preview/public/${token}/document?final=1`, { headers: { "X-Esign-Verification": verification.verificationToken } }), options);
    assert.equal(download.status, 200); const completed = await PDFDocument.load(await download.arrayBuffer()); assert.equal(completed.getPageCount(), 1);
    await api("/envelopes?workspaceId=101", { documentId: documents.items[0].id, title: "금지된 실제 수신자", order: "parallel", expiresAt: new Date(Date.now() + 86400000).toISOString(), recipients: [{ name: "가상 고객", email: "someone@real-company.com", channels: ["email"] }] }, 400);
    await api("/documents?workspaceId=999", undefined, 403);
    const otherOrg = await handleEsignPreviewRequest(new Request("http://localhost/api/esign-preview/outbox?workspaceId=101"), { ...options, actor: async () => ({ ...actor, orgId: "33333333-3333-4333-8333-333333333333" }) });
    const foreignMessages = (await otherOrg.json()).data as PreviewMessage[]; assert.ok(foreignMessages.every(item => item.envelopeId !== details[0].envelope.id));
});
