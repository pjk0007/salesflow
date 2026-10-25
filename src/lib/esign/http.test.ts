import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { createEsignQaFixture } from "../../../scripts/esign-qa-fixture";
import { handleEsignRequest } from "./http";
import type { EsignDocument, EsignField, PublicEsignSession, StaffEsignDetail } from "./types";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJklEQVR4nGP8z8Dwn4GBgYFxC4hkYGCCUAjAyMDwH6xCUlIKuwoA8JQFBIK0JaYAAAAASUVORK5CYII=";

for (const contentAddressedStorage of [false, true]) for (const phoneChannel of ["sms", "alimtalk"] as const) test(`real HTTP handler (${contentAddressedStorage ? "content addressed" : "conditional"}, ${phoneChannel}): template → two-channel invitation → sequential OTP/signing → stored final PDF/audit`, async () => {
    const fixture = await createEsignQaFixture({ contentAddressedStorage });
    try {
        async function api<T>(route: string, body?: unknown, options: { method?: string; expected?: number; headers?: Record<string, string> } = {}) {
            const response = await handleEsignRequest(new Request(`http://127.0.0.1/api/esign${route}`, {
                method: options.method ?? (body === undefined ? "GET" : "POST"),
                headers: { ...(body instanceof FormData || body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
                ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
            }), fixture.dependencies);
            const result = await response.json();
            assert.equal(response.status, options.expected ?? 200, JSON.stringify(result));
            return result.data as T;
        }
        const form = new FormData(); form.set("workspaceId", "101"); form.set("title", "가상 계약 템플릿"); form.set("kind", "template"); form.set("file", new File([new Uint8Array(fixture.pdfBytes)], "fake.pdf", { type: "application/pdf" }));
        let template = await api<EsignDocument>("/documents", form, { expected: 201 });
        const fields: EsignField[] = [0, 1].map(i => ({ id: `signature-${i}`, recipientIndex: i, type: "seal", pageIndex: 0, x: .15, y: .4 + i * .15, width: .2, height: .08, required: true }));
        template = await api(`/documents/${template.id}?workspaceId=101`, { version: template.version, fields }, { method: "PATCH" });
        await api(`/documents/${template.id}?workspaceId=101`, { version: 1, fields: [] }, { method: "PATCH", expected: 409 });
        const clone = await api<EsignDocument>("/documents?workspaceId=101", { sourceDocumentId: template.id, title: "가상 건별 계약", kind: "document", fields: template.fields }, { expected: 201 });
        assert.equal(clone.artifact.sha256, template.artifact.sha256); assert.notEqual(clone.id, template.id);
        const detail = await api<StaffEsignDetail>("/envelopes?workspaceId=101", {
            documentId: clone.id, title: "가상 순차 계약", order: "sequential", expiresAt: new Date(Date.now() + 86400000).toISOString(),
            recipients: [0, 1].map(i => ({ name: `가상 서명자 ${i}`, email: `fake-${i}@isolated.example.test`, phone: `0100000000${i}`, channels: ["email", phoneChannel] })),
        }, { expected: 201 });
        const id = detail.envelope.id;
        await fixture.flush();
        assert.equal(fixture.outbox.filter(j => j.kind === "invitation").length, 2, "only first signer receives both channels");
        const first = fixture.outbox.filter(j => j.kind === "invitation");
        assert.equal(first[0].payload.token, first[1].payload.token, "same contract link for email and SMS");
        const token0 = first[0].payload.token!;
        assert.equal((await api<PublicEsignSession>(`/public/${token0}`)).verified, false);
        await api(`/public/${token0}/document`, undefined, { expected: 401 });
        const verifications: string[] = [], tokens: string[] = [];
        for (let i = 0; i < 2; i++) {
            const token = fixture.outbox.find(j => j.kind === "invitation" && j.recipientId === detail.recipients[i].id)!.payload.token!;
            tokens.push(token);
            await api(`/public/${token}/otp`, { channel: i === 0 ? phoneChannel : "email" }); await fixture.flush();
            await api(`/public/${token}/otp`, { channel: "email" }, { expected: 429 });
            // UX-304: 재요청 제한 응답은 화면 카운트다운용 retryAt을 함께 준다.
            const cooldown = await (await handleEsignRequest(new Request(`http://127.0.0.1/api/esign/public/${token}/otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "email" }) }), fixture.dependencies)).json();
            assert.equal(cooldown.code, "cooldown"); assert.ok(Date.parse(cooldown.retryAt) > Date.now());
            const code = fixture.outbox.filter(j => j.kind === "otp" && j.recipientId === detail.recipients[i].id).at(-1)!.payload.code!;
            const verified = await api<{ verificationToken: string }>(`/public/${token}/verify`, { code }); verifications.push(verified.verificationToken);
            const input = { verificationToken: verified.verificationToken, idempotencyKey: `qa-submission-${i}`, consent: true, values: [{ fieldId: `signature-${i}`, pngDataUrl: png }] };
            await api(`/public/${token}/sign`, { ...input, values: [{ fieldId: `signature-${1 - i}`, pngDataUrl: png }] }, { expected: 400 });
            await api(`/public/${token}/sign`, input);
            await api(`/public/${token}/sign`, input); // Semantic replay must remain safe even if finalization has started.
            await fixture.flush();
        }
        const completed = await api<StaffEsignDetail>(`/envelopes/${id}?workspaceId=101`);
        assert.equal(completed.envelope.state, "completed"); assert.equal(completed.events.filter(e => e.type === "recipient.signed").length, 2);
        assert.equal(fixture.outbox.filter(j => j.kind === "completed").length, 4);
        assert.equal(completed.envelope.document.version, clone.version);
        const finalResponse = await handleEsignRequest(new Request(`http://127.0.0.1/api/esign/public/${tokens[0]}/document?final=1`, { headers: { "X-Esign-Verification": verifications[0] } }), fixture.dependencies);
        assert.equal(finalResponse.status, 200); assert.equal(finalResponse.headers.get("cache-control"), "no-store");
        const finalBytes = new Uint8Array(await finalResponse.arrayBuffer());
        assert.equal((await PDFDocument.load(finalBytes)).getPageCount(), 1);
        assert.equal(finalBytes.length, completed.envelope.finalArtifact!.size);
        const auditResponse = await handleEsignRequest(new Request(`http://127.0.0.1/api/esign/public/${tokens[0]}/audit`, { headers: { "X-Esign-Verification": verifications[0] } }), fixture.dependencies);
        assert.equal(auditResponse.status, 200); const auditText = await auditResponse.text();
        assert.ok(auditText.includes(completed.envelope.finalArtifact!.sha256)); assert.ok(!auditText.includes("fake-1@")); assert.ok(!auditText.includes("01000000001"));
        const unchanged = await api<EsignDocument>(`/documents/${template.id}?workspaceId=101`); assert.equal(unchanged.kind, "template"); assert.deepEqual(unchanged.fields, fields);
    } finally { await fixture.close(); }
});

test("HTTP boundary rejects unauthorized scope, malformed input, unavailable channels and cancelled signing", async () => {
    const fixture = await createEsignQaFixture();
    try {
        const send = (route: string, init?: RequestInit) => handleEsignRequest(new Request(`http://127.0.0.1/api/esign${route}`, init), fixture.dependencies);
        assert.equal((await send("/documents?workspaceId=999")).status, 403);
        assert.equal((await send("/documents?workspaceId=101", { headers: { "X-Qa-Deny": "yes" } })).status, 403);
        assert.equal((await send("/public/invalid")).status, 404);
        assert.equal((await send("/documents?workspaceId=101", { method: "POST", body: "{" })).status, 400);
        const form = new FormData(); form.set("workspaceId", "101"); form.set("title", "가짜 문서"); form.set("kind", "document"); form.set("file", new File(["not a pdf"], "invalid.pdf"));
        assert.equal((await send("/documents", { method: "POST", body: form })).status, 400);
        const response = await send("/envelopes?workspaceId=101", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients: [{ channels: ["sms"] }] }) });
        assert.equal(response.status, 400);
        fixture.engine.delivery.ready = async () => false;
        const blocked = await send("/envelopes?workspaceId=101", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients: [{ channels: ["sms"] }] }) });
        assert.equal(blocked.status, 503); assert.equal(fixture.outbox.length, 0);
    } finally { await fixture.close(); }
});

test("UX-264: 수신거부 목록의 이메일 수신자는 요청 생성 전에 409로 알리고, 정상 주소·조회 실패는 막지 않는다", async () => {
    const fixture = await createEsignQaFixture();
    try {
        const form = new FormData(); form.set("workspaceId", "101"); form.set("title", "가상 문서"); form.set("kind", "document"); form.set("file", new File([new Uint8Array(fixture.pdfBytes)], "fake.pdf", { type: "application/pdf" }));
        let lookup: (orgId: string, emails: string[]) => Promise<string[]> = async (_org, emails) => emails.filter(email => email.startsWith("blocked"));
        const dependencies = { ...fixture.dependencies, unsubscribedEmails: (orgId: string, emails: string[]) => lookup(orgId, emails) };
        const call = async (route: string, body: unknown, method = "POST") => { const response = await handleEsignRequest(new Request(`http://127.0.0.1/api/esign${route}`, { method, ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }), dependencies); return { status: response.status, body: await response.json() }; };
        const doc = (await call("/documents", form)).body.data as EsignDocument;
        await call(`/documents/${doc.id}?workspaceId=101`, { version: doc.version, fields: [{ id: "s", recipientIndex: 0, type: "signature", pageIndex: 0, x: .2, y: .4, width: .2, height: .08, required: true }] }, "PATCH");
        const envelope = (email: string, channels: string[]) => ({ documentId: doc.id, title: "가상 계약", order: "parallel", expiresAt: new Date(Date.now() + 86400000).toISOString(), recipients: [{ name: "가상 서명자", email, phone: "01000000001", channels }] });
        const blocked = await call("/envelopes?workspaceId=101", envelope("blocked@isolated.example.test", ["email"]));
        assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "recipient_unsubscribed"); assert.match(blocked.body.error, /b\*\*\*@isolated\.example\.test/);
        assert.equal((await call("/envelopes?workspaceId=101", envelope("blocked@isolated.example.test", ["sms"]))).status, 201, "이메일을 고르지 않으면 막지 않는다");
        assert.equal((await call("/envelopes?workspaceId=101", envelope("ok@isolated.example.test", ["email"]))).status, 201);
        lookup = async () => { throw new Error("fake-db-timeout"); };
        assert.equal((await call("/envelopes?workspaceId=101", envelope("blocked@isolated.example.test", ["email"]))).status, 201, "조회 실패는 발송 가드에 맡긴다");
    } finally { await fixture.close(); }
});

test("UX-261: 알림톡 상태 조회 일시 실패는 설정 안내가 아니라 재시도 안내(503 delivery_status_unavailable)이고 이메일·SMS는 영향 없다", async () => {
    const fixture = await createEsignQaFixture();
    try {
        const form = new FormData(); form.set("workspaceId", "101"); form.set("title", "가상 템플릿"); form.set("kind", "document"); form.set("file", new File([new Uint8Array(fixture.pdfBytes)], "fake.pdf", { type: "application/pdf" }));
        const call = async (route: string, body: unknown) => { const response = await handleEsignRequest(new Request(`http://127.0.0.1/api/esign${route}`, { method: "POST", ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) }), fixture.dependencies); return { status: response.status, body: await response.json() }; };
        const doc = (await call("/documents", form)).body.data as EsignDocument;
        await handleEsignRequest(new Request(`http://127.0.0.1/api/esign/documents/${doc.id}?workspaceId=101`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: doc.version, fields: [{ id: "s", recipientIndex: 0, type: "signature", pageIndex: 0, x: .2, y: .4, width: .2, height: .08, required: true }] }) }), fixture.dependencies);
        const envelope = (channels: string[]) => ({ documentId: doc.id, title: "가상 알림톡 계약", order: "parallel", expiresAt: new Date(Date.now() + 86400000).toISOString(), recipients: [{ name: "가상 서명자", email: "fake@isolated.example.test", phone: "01000000001", channels }] });
        const statuses = { approved: { ready: true, templates: [] }, unapproved: { ready: false, reason: "전자서명 템플릿 3종 승인 후 알림톡을 사용할 수 있습니다.", templates: [] }, timeout: { ready: false, unavailable: true, reason: "확인하지 못했습니다.", templates: [] } };
        let current: keyof typeof statuses = "approved";
        Object.assign(fixture.engine.delivery, { alimtalkStatus: async () => statuses[current] });
        const created = await call("/envelopes?workspaceId=101", envelope(["email", "alimtalk"]));
        assert.equal(created.status, 201);
        await fixture.flush();
        const token = fixture.outbox.find(j => j.kind === "invitation")!.payload.token!;
        current = "unapproved";
        const staffUnapproved = await call("/envelopes?workspaceId=101", envelope(["alimtalk"]));
        assert.equal(staffUnapproved.status, 503); assert.equal(staffUnapproved.body.code, "delivery_unconfigured"); assert.match(staffUnapproved.body.error, /템플릿 3종 승인 후/);
        const signerUnapproved = await call(`/public/${token}/otp`, { channel: "alimtalk" });
        assert.equal(signerUnapproved.body.code, "delivery_unconfigured"); assert.match(signerUnapproved.body.error, /요청자에게 문의/);
        current = "timeout";
        const staffTimeout = await call("/envelopes?workspaceId=101", envelope(["alimtalk"]));
        assert.equal(staffTimeout.status, 503); assert.equal(staffTimeout.body.code, "delivery_status_unavailable"); assert.doesNotMatch(staffTimeout.body.error, /먼저 완료/);
        const signerTimeout = await call(`/public/${token}/otp`, { channel: "alimtalk" });
        assert.equal(signerTimeout.body.code, "delivery_status_unavailable"); assert.match(signerTimeout.body.error, /잠시 후 다시 시도/); assert.doesNotMatch(signerTimeout.body.error, /요청자에게 문의/);
        const before = fixture.outbox.length;
        assert.equal((await call(`/public/${token}/otp`, { channel: "email" })).status, 200, "이메일 채널은 알림톡 조회 실패와 무관");
        assert.equal((await call("/envelopes?workspaceId=101", envelope(["email"]))).status, 201);
        await fixture.flush();
        assert.ok(fixture.outbox.length > before);
        assert.equal(fixture.outbox.filter(j => j.channel === "alimtalk" && j.kind === "otp").length, 0, "준비 안 된 알림톡으로는 확인 코드를 만들지 않는다");
    } finally { await fixture.close(); }
});
