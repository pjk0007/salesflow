import type { UnsubscribeList, UnsubscribeLookupResult } from "../types";

async function request<T>(url: string, orgId: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "X-Sendb-Org-Id": orgId, ...init?.headers } });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || "요청을 처리하지 못했습니다.");
    return body.data;
}

export function getUnsubscribes(url: string, orgId: string) {
    return request<UnsubscribeList>(url, orgId);
}

export function lookupUnsubscribes(orgId: string, targets: string[]) {
    return request<UnsubscribeLookupResult[]>("/api/email/unsubscribes/lookup", orgId, { method: "POST", body: JSON.stringify({ targets }) });
}

export function addUnsubscribe(orgId: string, email: string, reason: string) {
    return request<{ email: string }>("/api/email/unsubscribes", orgId, { method: "POST", body: JSON.stringify({ email, reason }) });
}
