import type { EsignDocument, EsignEnvelopeInput, EsignField, EsignChannel, EsignRecipientInput, PublicEsignSession, StaffEsignDetail } from "@/lib/esign/types";
import type { EsignAlimtalkStatus } from "@/lib/esign/alimtalk";

export type EsignStatus = { enabled: boolean; emailReady: boolean; smsReady: boolean; alimtalkReady?: boolean; alimtalk?: EsignAlimtalkStatus; storageReady: boolean; databaseReady: boolean; issues: string[] };
export type SigningValue = { fieldId: string; text?: string; pngDataUrl: string };
export type OtpResult = { retryAt?: string; expiresAt?: string; delivery?: { state: string }; message?: string; previewCode?: string };
export class EsignApiError extends Error { constructor(message: string, readonly status: number) { super(message); this.name = "EsignApiError"; } }

export const isEsignPreviewPage = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "1";
const apiBase = () => isEsignPreviewPage() ? "/api/esign-preview" : "/api/esign";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase()}${path}`, { cache: "no-store", ...init });
    const result = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: string } | null;
    if (!response.ok || !result?.success) throw new EsignApiError(result?.error || "요청을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요.", response.status);
    return result.data as T;
}
const json = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const scoped = (path: string, workspaceId: number) => `${path}${path.includes("?") ? "&" : "?"}workspaceId=${workspaceId}`;
const publicPath = (token: string, suffix = "") => `/public/${encodeURIComponent(token)}${suffix}`;
export const verificationHeaders = (token?: string): Record<string, string> => token ? { "X-Esign-Verification": token } : {};

export const esignApi = {
    status: () => request<EsignStatus>("/status"),
    documents: (workspaceId: number) => request<EsignDocument[]>(scoped("/documents", workspaceId)),
    envelopes: (workspaceId: number) => request<StaffEsignDetail[]>(scoped("/envelopes", workspaceId)),
    prefill: (workspaceId: number, identity: { recordId?: number; contactId?: string }) => request<EsignRecipientInput>(scoped(`/prefill?${identity.recordId ? `recordId=${identity.recordId}` : `contactId=${encodeURIComponent(identity.contactId || "")}`}`, workspaceId)),
    upload: (workspaceId: number, file: File, title: string, kind: "document" | "template") => {
        const body = new FormData(); body.set("workspaceId", String(workspaceId)); body.set("file", file); body.set("title", title); body.set("kind", kind);
        return request<EsignDocument>("/documents", { method: "POST", body });
    },
    updateDocument: (workspaceId: number, document: EsignDocument, fields: EsignField[], kind = document.kind, title = document.title) => request<EsignDocument>(scoped(`/documents/${document.id}`, workspaceId), { ...json({ title, kind, fields, version: document.version }), method: "PATCH" }),
    cloneDocument: (workspaceId: number, document: EsignDocument) => request<EsignDocument>(scoped("/documents", workspaceId), json({ sourceDocumentId: document.id, title: document.title, kind: "document", fields: document.fields })),
    createEnvelope: (workspaceId: number, input: EsignEnvelopeInput) => request<StaffEsignDetail>(scoped("/envelopes", workspaceId), json(input)),
    detail: (workspaceId: number, id: string) => request<StaffEsignDetail>(scoped(`/envelopes/${id}`, workspaceId)),
    cancel: (workspaceId: number, id: string) => request<StaffEsignDetail>(scoped(`/envelopes/${id}/action`, workspaceId), json({ action: "cancel" })),
    retryFinalization: (workspaceId: number, id: string) => request<StaffEsignDetail>(scoped(`/envelopes/${id}/action`, workspaceId), json({ action: "retry_finalize" })),
    documentUrl: (workspaceId: number, id: string) => `${apiBase()}${scoped(`/documents/${id}/file`, workspaceId)}`,
    envelopeUrl: (workspaceId: number, id: string, final = false) => `${apiBase()}${scoped(`/envelopes/${id}/file${final ? "?final=1" : ""}`, workspaceId)}`,
    auditUrl: (workspaceId: number, id: string) => `${apiBase()}${scoped(`/envelopes/${id}/audit`, workspaceId)}`,
    session: (token: string, verificationToken?: string) => request<PublicEsignSession>(publicPath(token), { headers: verificationHeaders(verificationToken) }),
    otp: (token: string, channel: EsignChannel) => request<OtpResult>(publicPath(token, "/otp"), json({ channel })),
    verify: (token: string, code: string) => request<{ verificationToken: string }>(publicPath(token, "/verify"), json({ code })),
    sign: (token: string, verificationToken: string, values: SigningValue[], idempotencyKey: string) => request<PublicEsignSession>(publicPath(token, "/sign"), json({ verificationToken, consent: true, values, idempotencyKey })),
    reject: (token: string, verificationToken: string, reason: string) => request<PublicEsignSession>(publicPath(token, "/sign"), json({ action: "reject", verificationToken, reason })),
    publicDocumentUrl: (token: string, final = false) => `${apiBase()}${publicPath(token, `/document${final ? "?final=1" : ""}`)}`,
    publicAuditUrl: (token: string) => `${apiBase()}${publicPath(token, "/audit")}`,
    previewOutbox: (workspaceId: number) => request<import("@/lib/esign/preview").PreviewMessage[]>(scoped("/outbox", workspaceId)),
};

/** Authenticated downloads cannot use a query string to carry the verification secret. */
export async function downloadFile(url: string, filename: string, verificationToken?: string) {
    const response = await fetch(url, { headers: verificationHeaders(verificationToken), cache: "no-store" });
    if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "파일을 내려받지 못했습니다.");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
