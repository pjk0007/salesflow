import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EsignAggregate, EsignRepository } from "./repository";
import { decryptPayload, encryptPayload, equalHash, otpHash, randomOtp, randomToken, secretKey, tokenHash } from "./crypto";
import { activeEnvelope, artifactInput, assertImageOwnership, maskEmail, maskPhone, MAX_OTP_ATTEMPTS, OTP_COOLDOWN_MS, OTP_TTL_MS, parseDocument, parseEnvelope, recipientWaiting, uniqueImageBudget, validateValues, VERIFY_TTL_MS } from "./rules";
import { ESIGN_PDF_LIMITS } from "./pdf-types";
import { EsignError, type DeliveryOutcome, type DeliveryPayload, type EsignActor, type EsignDocumentInput, type EsignEnvelopeInput, type EsignEvent, type EsignJob, type EsignRecipient, type FinalizedArtifact, type PublicEsignSession, type SignatureInput, type StaffEsignDetail } from "./types";

const at = (date: Date, milliseconds = 0) => new Date(date.getTime() + milliseconds).toISOString();
const safeError = (message?: string) => (message?.slice(0, 200) || "처리 결과를 확인해주세요.");
function authorize(actor: EsignActor, value: EsignAggregate) {
    if (actor.orgId !== value.envelope.orgId || actor.workspaceId !== value.envelope.workspaceId)
        throw new EsignError("서명 요청을 찾을 수 없습니다.", 404, "not_found");
}
function event(value: EsignAggregate, type: string, now: Date, details: Partial<Pick<EsignEvent, "actorId" | "recipientId">> = {}, data: Record<string, unknown> = {}) {
    value.events.push({ id: randomUUID(), envelopeId: value.envelope.id, type, at: at(now), ...details, data });
    value.envelope.updatedAt = at(now);
}
function stopJobs(value: EsignAggregate, now: Date) {
    for (const job of value.jobs) {
        if (["pending", "blocked", "processing"].includes(job.state)) job.state = "cancelled";
        job.updatedAt = at(now);
        delete job.encryptedPayload; delete job.leaseId; delete job.leaseUntil;
    }
}
function retireOtpJobs(value: EsignAggregate, recipientId: string, now: Date) {
    for (const job of value.jobs) if (job.kind === "otp" && job.recipientId === recipientId) {
        if (["pending", "blocked"].includes(job.state)) job.state = "cancelled";
        delete job.encryptedPayload;
        job.updatedAt = at(now);
    }
}
function expire(value: EsignAggregate, now: Date) {
    if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= now) {
        value.envelope.state = "expired"; stopJobs(value, now); event(value, "envelope.expired", now);
    }
}
function authenticated(recipient: EsignRecipient, verificationToken: string | undefined, now: Date) {
    return !!verificationToken && !!recipient.verificationHash && !!recipient.verificationExpiresAt &&
        new Date(recipient.verificationExpiresAt) > now && equalHash(recipient.verificationHash, tokenHash(verificationToken));
}
function requireVerification(recipient: EsignRecipient, verificationToken: string | undefined, now: Date) {
    if (!authenticated(recipient, verificationToken, now)) throw new EsignError("확인 코드를 다시 입력해주세요.", 401, "verification_required");
}
function canAuthenticate(value: EsignAggregate, recipient: EsignRecipient, now: Date) {
    if (value.envelope.state === "pending") {
        activeEnvelope(value.envelope, now);
        if (recipientWaiting(value.envelope, value.recipients, recipient)) throw new EsignError("앞 서명자의 서명을 기다리고 있습니다.", 409, "waiting");
        return;
    }
    if (["finalizing", "completed"].includes(value.envelope.state) && recipient.state === "signed") return;
    throw new EsignError("현재 확인할 수 없는 서명 요청입니다.", value.envelope.state === "expired" ? 410 : 409, value.envelope.state);
}
function detail(value: EsignAggregate): StaffEsignDetail {
    return {
        envelope: structuredClone(value.envelope),
        recipients: value.recipients.map((r) => {
            const { tokenHash: _token, otpHash: _otp, otpChallenge: _challenge, otpExpiresAt: _otpExpires, otpRetryAt: _retry, otpAttempts: _attempts, verificationHash: _verification, verificationExpiresAt: _verifiedExpiry, submissionKey: _submission, submissionHash: _submissionHash, ...safe } = r;
            void [_token, _otp, _challenge, _otpExpires, _retry, _attempts, _verification, _verifiedExpiry, _submission, _submissionHash];
            return structuredClone(safe);
        }),
        jobs: value.jobs.map((j) => { const { encryptedPayload: _payload, leaseId: _lease, ...safe } = j; void [_payload, _lease]; return structuredClone(safe); }),
        events: structuredClone(value.events),
    };
}

/** Pure state transitions; callers perform storage, PDF rendering and transport calls outside repository locks. */
export class EsignService {
    readonly repository: EsignRepository;
    private readonly secret: string;
    private readonly clock: () => Date;
    constructor(options: { repository: EsignRepository; secret: string; clock?: () => Date }) {
        secretKey(options.secret);
        this.repository = options.repository; this.secret = options.secret; this.clock = options.clock ?? (() => new Date());
    }
    private job(value: EsignAggregate, now: Date, input: Pick<EsignJob, "key" | "kind" | "state"> & Partial<Pick<EsignJob, "channel" | "recipientId">>, payload?: DeliveryPayload) {
        const job: EsignJob = { id: randomUUID(), envelopeId: value.envelope.id, ...input, attempts: 0, availableAt: at(now), createdAt: at(now), updatedAt: at(now) };
        if (payload) job.encryptedPayload = encryptPayload(this.secret, payload, job.id);
        value.jobs.push(job); return job;
    }
    async createDocument(actor: EsignActor, raw: EsignDocumentInput) {
        const document = { ...parseDocument(raw), id: randomUUID(), orgId: actor.orgId, workspaceId: actor.workspaceId, createdBy: actor.userId, version: 1, createdAt: at(this.clock()) };
        await this.repository.saveDocument(document); return document;
    }
    listDocuments(actor: EsignActor) { return this.repository.documents(actor); }
    async getDocument(actor: EsignActor, id: string) {
        const document = await this.repository.document(actor, z.string().uuid().parse(id));
        if (!document) throw new EsignError("문서를 찾을 수 없습니다.", 404, "not_found");
        return document;
    }
    async updateDocument(actor: EsignActor, id: string, raw: { title?: string; kind?: "document" | "template"; fields?: EsignDocumentInput["fields"]; version: number }) {
        const patch = z.object({ title: z.string().trim().min(1).max(200).optional(), kind: z.enum(["document", "template"]).optional(), fields: z.array(z.unknown()).max(100).optional(), version: z.number().int().positive() }).strict().parse(raw);
        const current = await this.getDocument(actor, id);
        if (current.version !== patch.version) throw new EsignError("문서가 변경되었습니다. 다시 열어주세요.", 409, "conflict");
        const input = parseDocument({ title: patch.title ?? current.title, kind: patch.kind ?? current.kind, artifact: current.artifact, pages: current.pages, fields: (patch.fields ?? current.fields) as EsignDocumentInput["fields"] });
        const next = { ...current, ...input, version: current.version + 1 };
        await this.repository.saveDocument(next, current.version); return next;
    }
    async createEnvelope(actor: EsignActor, raw: EsignEnvelopeInput) {
        const now = this.clock(), input = parseEnvelope(raw, now), document = await this.getDocument(actor, input.documentId);
        if (!document.fields.length || document.fields.some((f) => f.recipientIndex >= input.recipients.length)) throw new EsignError("문서 입력란의 서명자를 확인해주세요.");
        for (let index = 0; index < input.recipients.length; index++) if (!document.fields.some((f) => f.recipientIndex === index && f.required && ["signature", "seal"].includes(f.type)))
            throw new EsignError("모든 서명자에게 필수 서명 또는 도장 입력란이 필요합니다.");
        const id = randomUUID(), value: EsignAggregate = {
            envelope: { id, orgId: actor.orgId, workspaceId: actor.workspaceId, title: input.title, order: input.order, state: "draft", version: 1, document: structuredClone(document), expiresAt: new Date(input.expiresAt).toISOString(), createdBy: actor.userId, createdAt: at(now), updatedAt: at(now) },
            recipients: [], events: [], jobs: [],
        };
        input.recipients.forEach((rawRecipient, index) => {
            const token = randomToken(), recipient: EsignRecipient = { ...rawRecipient, id: randomUUID(), envelopeId: id, index, state: "pending", tokenHash: tokenHash(token), otpAttempts: 0 };
            value.recipients.push(recipient);
            for (const channel of recipient.channels) this.job(value, now, { kind: "invitation", state: "blocked", key: `invitation:${recipient.id}:${channel}`, recipientId: recipient.id, channel }, { token, email: recipient.email, phone: recipient.phone, name: recipient.name, title: input.title, expiresAt: value.envelope.expiresAt });
        });
        event(value, "envelope.created", now, { actorId: actor.userId }, { sourceSha256: document.artifact.sha256, documentVersion: document.version });
        await this.repository.create(value); return detail(value);
    }
    async listEnvelopes(actor: EsignActor) {
        const now = this.clock();
        return (await this.repository.list(actor)).map((value) => {
            // Effective status is readable immediately; bounded expiry processing persists its audit/cleanup.
            if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= now) value.envelope.state = "expired";
            return detail(value);
        });
    }
    async expireDue(limit = 5) {
        const now = this.clock(), bounded = Number.isFinite(limit) ? Math.min(10, Math.max(1, Math.trunc(limit))) : 5;
        const ids = await this.repository.dueExpirations(at(now), bounded);
        for (const id of ids) await this.repository.mutate(id, (value) => { expire(value, now); });
        return { processed: ids.length };
    }
    async getEnvelope(actor: EsignActor, id: string) {
        const value = await this.repository.read(z.string().uuid().parse(id));
        if (!value) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404, "not_found");
        authorize(actor, value);
        if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= this.clock())
            return this.repository.mutate(id, (a) => { expire(a, this.clock()); return detail(a); });
        return detail(value);
    }
    async dispatchEnvelope(actor: EsignActor, id: string) {
        const now = this.clock();
        return this.repository.mutate(id, (value) => {
            authorize(actor, value);
            if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= now)
                throw new EsignError("서명 요청이 만료되었습니다.", 410, "expired");
            if (value.envelope.state === "pending") return detail(value);
            if (value.envelope.state !== "draft") throw new EsignError("발송할 수 없는 서명 요청입니다.", 409);
            if (new Date(value.envelope.expiresAt) <= now) throw new EsignError("서명 요청이 만료되었습니다.", 410, "expired");
            value.envelope.state = "pending";
            for (const job of value.jobs) if (job.kind === "invitation" && (value.envelope.order === "parallel" || job.recipientId === value.recipients[0].id)) job.state = "pending";
            event(value, "envelope.dispatched", now, { actorId: actor.userId }); return detail(value);
        });
    }
    async cancelEnvelope(actor: EsignActor, id: string) {
        const now = this.clock();
        return this.repository.mutate(id, (value) => {
            authorize(actor, value);
            if (value.envelope.state === "cancelled") return detail(value);
            if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= now)
                throw new EsignError("서명 요청이 만료되었습니다.", 410, "expired");
            if (!["draft", "pending"].includes(value.envelope.state)) throw new EsignError("현재 취소할 수 없는 서명 요청입니다.", 409);
            value.envelope.state = "cancelled"; stopJobs(value, now); event(value, "envelope.cancelled", now, { actorId: actor.userId }); return detail(value);
        });
    }
    private async locate(token: string) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new EsignError("서명 링크를 찾을 수 없습니다.", 404, "not_found");
        const found = await this.repository.recipientByTokenHash(tokenHash(token));
        if (!found) throw new EsignError("서명 링크를 찾을 수 없습니다.", 404, "not_found");
        return found;
    }
    async publicSession(token: string, verificationToken?: string): Promise<PublicEsignSession> {
        const found = await this.locate(token), now = this.clock();
        let value = await this.repository.read(found.envelopeId);
        if (!value) throw new EsignError("서명 링크를 찾을 수 없습니다.", 404, "not_found");
        if (["draft", "pending"].includes(value.envelope.state) && new Date(value.envelope.expiresAt) <= now)
            value = await this.repository.mutate(found.envelopeId, (a) => { expire(a, now); return a; });
            const r = value.recipients.find((r) => r.id === found.recipientId)!, verified = authenticated(r, verificationToken, now);
            const { id, title, state, order, expiresAt, completedAt } = value.envelope;
            const accessible = verified && ["pending", "finalizing", "completed"].includes(state);
            return { envelope: { id, title, state, order, expiresAt, completedAt }, recipient: { id: r.id, index: r.index, name: r.name, state: r.state, channels: r.channels, signedAt: r.signedAt, maskedEmail: maskEmail(r.email), maskedPhone: maskPhone(r.phone) }, waiting: recipientWaiting(value.envelope, value.recipients, r), verified: accessible,
                ...(accessible ? { document: structuredClone(value.envelope.document), values: structuredClone(r.values), ...(state === "completed" ? { finalArtifact: value.envelope.finalArtifact } : {}) } : {}) };
    }
    async requestOtp(token: string, channel: "email" | "alimtalk" | "sms") {
        z.enum(["email", "alimtalk", "sms"]).parse(channel);
        const found = await this.locate(token), now = this.clock();
        return this.repository.mutate(found.envelopeId, (value) => {
            const r = value.recipients.find((r) => r.id === found.recipientId)!;
            canAuthenticate(value, r, now);
            if (!r.channels.includes(channel)) throw new EsignError("이 서명 요청에 지정되지 않은 채널입니다.", 403);
            if ((r.otpRetryAt && new Date(r.otpRetryAt) > now) || (r.otpAttempts >= MAX_OTP_ATTEMPTS && r.otpExpiresAt && new Date(r.otpExpiresAt) > now))
                throw new EsignError("잠시 후 확인 코드를 다시 요청해주세요.", 429, "cooldown");
            const challenge = randomUUID(), code = randomOtp();
            r.otpChallenge = challenge; r.otpHash = otpHash(this.secret, r.id, challenge, code);
            r.otpExpiresAt = at(now, OTP_TTL_MS); r.otpRetryAt = at(now, OTP_COOLDOWN_MS); r.otpAttempts = 0;
            for (const j of value.jobs) if (j.recipientId === r.id && j.kind === "otp" && j.state === "pending") { j.state = "cancelled"; delete j.encryptedPayload; j.updatedAt = at(now); }
            this.job(value, now, { kind: "otp", state: "pending", key: `otp:${r.id}:${challenge}`, recipientId: r.id, channel }, { code, otpChallenge: challenge, email: r.email, phone: r.phone, name: r.name, title: value.envelope.title });
            event(value, "recipient.otp_requested", now, { recipientId: r.id }, { channel });
            return { channel, destination: channel === "email" ? maskEmail(r.email) : maskPhone(r.phone), retryAt: r.otpRetryAt, expiresAt: r.otpExpiresAt };
        });
    }
    async verifyOtp(token: string, code: string) {
        const found = await this.locate(token), now = this.clock();
        const result = await this.repository.mutate(found.envelopeId, (value) => {
            const r = value.recipients.find((r) => r.id === found.recipientId)!;
            canAuthenticate(value, r, now);
            if (!r.otpHash || !r.otpChallenge || !r.otpExpiresAt || new Date(r.otpExpiresAt) <= now || r.otpAttempts >= MAX_OTP_ATTEMPTS)
                return { error: "확인 코드가 만료되었습니다. 다시 요청해주세요.", status: 401 } as const;
            r.otpAttempts++;
            if (!/^\d{6}$/.test(code) || !equalHash(r.otpHash, otpHash(this.secret, r.id, r.otpChallenge, code))) {
                event(value, "recipient.otp_failed", now, { recipientId: r.id }, { attempt: r.otpAttempts });
                return { error: "확인 코드가 일치하지 않습니다.", status: 401 } as const;
            }
            const verificationToken = randomToken();
            r.verificationHash = tokenHash(verificationToken); r.verificationExpiresAt = at(now, VERIFY_TTL_MS);
            delete r.otpHash; delete r.otpChallenge; delete r.otpExpiresAt;
            retireOtpJobs(value, r.id, now);
            event(value, "recipient.verified", now, { recipientId: r.id });
            return { verificationToken, expiresAt: r.verificationExpiresAt };
        });
        if (result.error) throw new EsignError(result.error, result.status, "otp_invalid");
        return result;
    }
    async submitSignature(token: string, raw: SignatureInput) {
        const found = await this.locate(token), now = this.clock();
        z.object({ verificationToken: z.string().min(40).max(100), idempotencyKey: z.string().min(8).max(120), consent: z.literal(true), values: z.array(z.unknown()).max(100) }).strict().parse(raw);
        return this.repository.mutate(found.envelopeId, (value) => {
            const r = value.recipients.find((r) => r.id === found.recipientId)!;
            requireVerification(r, raw.verificationToken, now);
            const values = validateValues(value.envelope.document.fields, r.index, raw.values);
            for (const v of values) if (v.artifact) assertImageOwnership(v.artifact, value.envelope.id, r.id);
            // The route may upload identical bytes again under a different immutable key.
            const semanticValues = [...values].sort((a, b) => a.fieldId.localeCompare(b.fieldId)).map((v) => ({
                fieldId: v.fieldId,
                text: v.text,
                ...(v.artifact ? { artifact: { sha256: v.artifact.sha256, size: v.artifact.size, contentType: v.artifact.contentType } } : {}),
            }));
            const hash = tokenHash(JSON.stringify(semanticValues));
            if (r.state === "signed") {
                if (r.submissionKey === raw.idempotencyKey && r.submissionHash === hash) {
                    uniqueImageBudget([...(r.values ?? []), ...values]);
                    return { state: value.envelope.state, signedAt: r.signedAt };
                }
                throw new EsignError("이미 제출한 서명은 수정할 수 없습니다.", 409, "already_signed");
            }
            activeEnvelope(value.envelope, now);
            if (recipientWaiting(value.envelope, value.recipients, r)) throw new EsignError("앞 서명자의 서명을 기다려주세요.", 409, "waiting");
            const budget = uniqueImageBudget([...values, ...value.recipients.filter((other) => other.id !== r.id && other.state === "signed").flatMap((other) => other.values ?? [])]);
            if (budget.bytes > ESIGN_PDF_LIMITS.totalPngBytes || budget.pixels > ESIGN_PDF_LIMITS.totalPngPixels)
                throw new EsignError("문서 전체의 서명 이미지는 8MB·800만 픽셀 이하여야 합니다. 이미지 크기를 줄여주세요.", 413, "image_budget_exceeded");
            r.values = values; r.state = "signed"; r.signedAt = at(now); r.consentAt = at(now); r.submissionKey = raw.idempotencyKey; r.submissionHash = hash;
            retireOtpJobs(value, r.id, now);
            event(value, "recipient.signed", now, { recipientId: r.id }, { sourceSha256: value.envelope.document.artifact.sha256, submissionHash: hash, consent: true });
            if (value.recipients.every((r) => r.state === "signed")) {
                value.envelope.state = "finalizing";
                this.job(value, now, { kind: "finalize", state: "pending", key: `finalize:${value.envelope.id}` });
                event(value, "envelope.finalizing", now);
            } else if (value.envelope.order === "sequential") {
                const next = value.recipients.find((next) => next.state === "pending")!;
                for (const j of value.jobs) if (j.kind === "invitation" && j.recipientId === next.id && j.state === "blocked") { j.state = "pending"; j.updatedAt = at(now); }
            }
            return { state: value.envelope.state, signedAt: r.signedAt };
        });
    }
    async reject(token: string, raw: { verificationToken: string; reason?: string }) {
        const found = await this.locate(token), now = this.clock(), input = z.object({ verificationToken: z.string().min(40).max(100), reason: z.string().trim().max(500).optional() }).strict().parse(raw);
        return this.repository.mutate(found.envelopeId, (value) => {
            const r = value.recipients.find((r) => r.id === found.recipientId)!;
            requireVerification(r, input.verificationToken, now); activeEnvelope(value.envelope, now);
            if (r.state !== "pending" || recipientWaiting(value.envelope, value.recipients, r)) throw new EsignError("현재 거절할 수 없는 요청입니다.", 409);
            r.state = "rejected"; value.envelope.state = "rejected"; stopJobs(value, now);
            event(value, "envelope.rejected", now, { recipientId: r.id }, { reason: input.reason ?? "" }); return { state: value.envelope.state };
        });
    }
    async claimJob(leaseMs = 60000) {
        const now = this.clock(), bounded = Math.min(300000, Math.max(10000, leaseMs));
        for (let i = 0; i < 10; i++) {
            const job = await this.repository.claimJob(at(now), at(now, bounded), randomUUID());
            if (!job) return null;
            const allowed = await this.repository.mutate(job.envelopeId, (value) => {
                expire(value, now);
                const stored = value.jobs.find((j) => j.id === job.id)!;
                let valid = stored.state === "processing" && stored.leaseId === job.leaseId &&
                    (stored.kind === "finalize" ? value.envelope.state === "finalizing" : stored.kind === "completed" ? value.envelope.state === "completed" : ["pending", "finalizing", "completed"].includes(value.envelope.state));
                const recipient = value.recipients.find((r) => r.id === stored.recipientId);
                if (valid && stored.kind === "invitation") valid = value.envelope.state === "pending" && recipient?.state === "pending" && !recipientWaiting(value.envelope, value.recipients, recipient);
                if (valid && stored.kind === "otp") {
                    const payload = this.decodeJob(stored);
                    valid = !!recipient?.otpExpiresAt && new Date(recipient.otpExpiresAt) > now && recipient.otpChallenge === payload.otpChallenge;
                }
                if (!valid && stored.state === "processing") {
                    stored.state = "cancelled";
                    if (stored.kind !== "invitation") delete stored.encryptedPayload;
                    delete stored.leaseId; delete stored.leaseUntil;
                }
                return valid;
            });
            if (allowed) return job;
        }
        return null;
    }
    decodeJob(job: EsignJob): DeliveryPayload {
        if (!job.encryptedPayload) return {};
        return decryptPayload<DeliveryPayload>(this.secret, job.encryptedPayload, job.id);
    }
    private assertLease(job: EsignJob | undefined, leaseId: string, now: Date) {
        if (!job || job.state !== "processing" || job.leaseId !== leaseId || !job.leaseUntil || new Date(job.leaseUntil) <= now)
            throw new EsignError("작업 처리 권한이 만료되었습니다.", 409, "lease_lost");
        return job;
    }
    async completeDelivery(jobId: string, envelopeId: string, leaseId: string, outcome: DeliveryOutcome) {
        const now = this.clock();
        z.object({ state: z.enum(["accepted", "failed", "unknown"]), providerId: z.string().max(200).optional(), error: z.string().max(200).optional() }).strict().parse(outcome);
        return this.repository.mutate(envelopeId, (value) => {
            const job = this.assertLease(value.jobs.find((j) => j.id === jobId), leaseId, now);
            if (job.kind === "finalize") throw new EsignError("PDF 완료 작업은 발송 결과로 닫을 수 없습니다.", 409);
            job.state = outcome.state; job.providerId = outcome.providerId; job.error = outcome.state === "accepted" ? undefined : safeError(outcome.error);
            job.updatedAt = at(now);
            if (job.kind !== "invitation") delete job.encryptedPayload;
            delete job.leaseId; delete job.leaseUntil;
            event(value, "delivery.result", now, { recipientId: job.recipientId }, { jobId: job.id, channel: job.channel, state: job.state }); return { state: job.state };
        });
    }
    async getFinalizationInput(jobId: string, envelopeId: string, leaseId: string) {
        const value = await this.repository.read(envelopeId);
        if (!value) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404);
        const job = this.assertLease(value.jobs.find((j) => j.id === jobId), leaseId, this.clock());
        if (job.kind !== "finalize" || value.envelope.state !== "finalizing" || !value.recipients.every((r) => r.state === "signed")) throw new EsignError("완료 문서를 생성할 수 없는 요청입니다.", 409);
        return { envelope: value.envelope, document: value.envelope.document, recipients: value.recipients.map((r) => ({ id: r.id, index: r.index, name: r.name, signedAt: r.signedAt, consentAt: r.consentAt, values: r.values ?? [] })) };
    }
    async finishEnvelope(jobId: string, envelopeId: string, leaseId: string, input: FinalizedArtifact) {
        const now = this.clock(), artifact = artifactInput.extend({ size: z.number().int().min(1).max(25 * 1024 * 1024) }).parse(input.artifact);
        if (input.verified !== true || artifact.contentType !== "application/pdf") throw new EsignError("완료 문서 저장 검증이 필요합니다.", 409);
        return this.repository.mutate(envelopeId, (value) => {
            if (value.envelope.state === "completed" && value.envelope.finalArtifact?.sha256 === artifact.sha256 && value.envelope.finalArtifact.key === artifact.key) return detail(value);
            const job = this.assertLease(value.jobs.find((j) => j.id === jobId), leaseId, now);
            if (job.kind !== "finalize" || value.envelope.state !== "finalizing" || !value.recipients.every((r) => r.state === "signed")) throw new EsignError("현재 완료할 수 없는 요청입니다.", 409);
            if (artifact.key === value.envelope.document.artifact.key || artifact.sha256 === value.envelope.document.artifact.sha256) throw new EsignError("완료 문서가 원본과 구분되지 않습니다.", 409);
            value.envelope.finalArtifact = artifact; value.envelope.completedAt = at(now); value.envelope.state = "completed";
            job.state = "accepted"; job.updatedAt = at(now); delete job.leaseId; delete job.leaseUntil;
            for (const recipient of value.recipients) {
                const invitation = value.jobs.find((j) => j.kind === "invitation" && j.recipientId === recipient.id && j.encryptedPayload);
                const token = invitation ? this.decodeJob(invitation).token : undefined;
                if (!token) throw new EsignError("완료 알림의 서명자 링크를 확인할 수 없습니다.", 503, "configuration");
                for (const channel of recipient.channels) this.job(value, now, { kind: "completed", state: "pending", key: `completed:${recipient.id}:${channel}`, recipientId: recipient.id, channel }, { token, email: recipient.email, phone: recipient.phone, name: recipient.name, title: value.envelope.title });
            }
            for (const invitation of value.jobs) if (invitation.kind === "invitation") delete invitation.encryptedPayload;
            event(value, "envelope.completed", now, {}, { sourceSha256: value.envelope.document.artifact.sha256, finalSha256: artifact.sha256 }); return detail(value);
        });
    }
    async failFinalization(jobId: string, envelopeId: string, leaseId: string) {
        const now = this.clock();
        return this.repository.mutate(envelopeId, (value) => {
            const job = this.assertLease(value.jobs.find((j) => j.id === jobId), leaseId, now);
            if (job.kind !== "finalize") throw new EsignError("완료 PDF 작업이 아닙니다.", 409);
            job.state = job.attempts < 3 ? "pending" : "failed"; job.availableAt = at(now, Math.min(60000, 10000 * job.attempts));
            job.error = "완료 PDF를 저장하지 못했습니다."; job.updatedAt = at(now); delete job.leaseId; delete job.leaseUntil;
            event(value, "envelope.finalization_failed", now, {}, { attempt: job.attempts }); return { state: job.state };
        });
    }
}
