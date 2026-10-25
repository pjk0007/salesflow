import type { PdfPage } from "./pdf-types";
/** All dates cross the API boundary as ISO strings; PDF coordinates use the visible rotated page. */
export type EsignChannel = "email" | "alimtalk" | "sms";
export type EnvelopeState = "draft" | "pending" | "finalizing" | "completed" | "cancelled" | "rejected" | "expired";
export type RecipientState = "pending" | "signed" | "rejected";
export type JobState = "blocked" | "pending" | "processing" | "accepted" | "failed" | "unknown" | "cancelled";
export type JobKind = "invitation" | "otp" | "finalize" | "completed";
/** orgName은 서명 요청 안내의 '요청한 곳' 표시용(요청 생성 경로에서만 채운다). */
export type EsignActor = { orgId: string; workspaceId: number; userId: string; name: string; orgName?: string };
export type EsignArtifact = { key: string; sha256: string; size: number; contentType: "application/pdf" | "image/png" };
export type EsignPage = PdfPage;
export type EsignField = {
    id: string; recipientIndex: number; type: "signature" | "seal" | "name" | "date" | "text";
    pageIndex: number; x: number; y: number; width: number; height: number; required: boolean; label?: string;
};
export type EsignValue = { fieldId: string; text?: string; artifact?: EsignArtifact; raster?: { width: number; height: number } };
export type EsignDocumentInput = {
    title: string; kind: "document" | "template"; artifact: EsignArtifact; pages: EsignPage[]; fields: EsignField[];
};
export type EsignDocument = EsignDocumentInput & {
    id: string; orgId: string; workspaceId: number; version: number; createdBy: string; createdAt: string;
};
export type EsignRecipientInput = { name: string; email?: string; phone?: string; channels: EsignChannel[]; contactId?: string; recordId?: number };
export type EsignEnvelopeInput = {
    documentId: string; title: string; order: "parallel" | "sequential"; expiresAt: string; recipients: EsignRecipientInput[];
};
export type EsignEnvelope = {
    id: string; orgId: string; workspaceId: number; title: string; order: "parallel" | "sequential";
    state: EnvelopeState; version: number; document: EsignDocument; expiresAt: string;
    createdBy: string; createdAt: string; updatedAt: string; completedAt?: string; finalArtifact?: EsignArtifact;
};
export type EsignRecipient = EsignRecipientInput & {
    id: string; envelopeId: string; index: number; state: RecipientState; tokenHash: string;
    otpHash?: string; otpChallenge?: string; otpExpiresAt?: string; otpRetryAt?: string; otpAttempts: number;
    verificationHash?: string; verificationExpiresAt?: string;
    signedAt?: string; consentAt?: string; submissionKey?: string; submissionHash?: string; values?: EsignValue[];
};
export type EsignEvent = {
    id: string; envelopeId: string; type: string; at: string; actorId?: string; recipientId?: string;
    data: Record<string, unknown>;
};
export type EsignJob = {
    id: string; envelopeId: string; recipientId?: string; kind: JobKind; channel?: EsignChannel;
    state: JobState; key: string; encryptedPayload?: string; attempts: number; availableAt: string;
    leaseId?: string; leaseUntil?: string; providerId?: string; error?: string; createdAt: string; updatedAt: string;
};
export type DeliveryPayload = { token?: string; code?: string; otpChallenge?: string; email?: string; phone?: string; name?: string; title?: string; expiresAt?: string; orgName?: string };
export type PublicRecipient = Pick<EsignRecipient, "id" | "index" | "name" | "state" | "channels" | "signedAt"> & { maskedEmail?: string; maskedPhone?: string };
export type PublicEsignSession = {
    envelope: Pick<EsignEnvelope, "id" | "title" | "state" | "order" | "expiresAt" | "completedAt">;
    recipient: PublicRecipient; waiting: boolean; verified: boolean;
    document?: EsignDocument; values?: EsignValue[]; finalArtifact?: EsignArtifact;
};
export type StaffRecipient = Omit<EsignRecipient, "tokenHash" | "otpHash" | "otpChallenge" | "otpExpiresAt" | "otpRetryAt" | "otpAttempts" | "verificationHash" | "verificationExpiresAt" | "submissionKey" | "submissionHash">;
export type EsignListQuery = { query?: string; cursor?: string; limit?: number };
/** total은 현재 검색 조건 전체 건수, nextCursor가 있으면 다음 페이지가 있다. */
export type EsignListPage<T> = { items: T[]; nextCursor: string | null; total: number };
export type StaffEsignSummary = { envelope: Omit<EsignEnvelope, "document">; recipients: StaffRecipient[] };
export type StaffEsignDetail = { envelope: EsignEnvelope; recipients: StaffRecipient[]; jobs: Omit<EsignJob, "encryptedPayload" | "leaseId">[]; events: EsignEvent[] };
export type SignatureInput = { verificationToken: string; idempotencyKey: string; consent: true; values: EsignValue[] };
export type DeliveryOutcome = { state: "accepted" | "failed" | "unknown"; providerId?: string; error?: string };
export type FinalizedArtifact = { artifact: EsignArtifact; verified: true };
export class EsignError extends Error {
    /** details는 응답 최상위에 함께 실린다(예: retryAt·remainingAttempts). 비밀값을 넣지 않는다. */
    constructor(message: string, readonly status = 400, readonly code = "invalid", readonly details?: { retryAt?: string; remainingAttempts?: number }) { super(message); this.name = "EsignError"; }
}
