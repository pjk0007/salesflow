import { apiRequest } from "@/lib/swr-fetcher";
import type { FieldTemplate } from "@/lib/field-templates";

/** apiRequest와 같은 모양. 시험에서는 가짜 전송을 넣는다. */
export type OnboardingRequest = <T>(url: string, options?: RequestInit) => Promise<T>;

const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

export function saveOnboardingOrg(
    input: { name: string; industry: string; companySize: string },
    request: OnboardingRequest = apiRequest,
) {
    return request("/api/org", json("PUT", {
        name: input.name.trim() || undefined,
        industry: input.industry || undefined,
        companySize: input.companySize || undefined,
    }));
}

/**
 * 2단계 저장. 이미 만든 워크스페이스가 있으면 새로 만들지 않고 이름·아이콘만 고친다
 * (뒤로 갔다 다시 '다음'을 눌러도 워크스페이스는 하나 — UX-001).
 */
export async function saveOnboardingWorkspace(
    input: { workspaceId: number | null; name: string; icon: string },
    request: OnboardingRequest = apiRequest,
): Promise<number> {
    const name = input.name.trim();
    const result = input.workspaceId
        ? await request<{ data: { id: number } }>(`/api/workspaces/${input.workspaceId}/settings`, json("PATCH", { name, icon: input.icon }))
        : await request<{ data: { id: number } }>("/api/workspaces", json("POST", { name, icon: input.icon || undefined }));
    return result.data.id;
}

export interface TemplateApplyResult {
    created: number;
    skippedItems: Array<{ key: string; reason: string }>;
}

export async function applyOnboardingTemplate(
    workspaceId: number,
    fields: FieldTemplate["fields"],
    request: OnboardingRequest = apiRequest,
): Promise<TemplateApplyResult> {
    const result = await request<{ data: { created: number; skippedItems?: TemplateApplyResult["skippedItems"] } }>(
        `/api/workspaces/${workspaceId}/fields/bulk`,
        json("POST", { fields }),
    );
    return { created: result.data.created, skippedItems: result.data.skippedItems ?? [] };
}

/** 입력 칸의 이메일을 정리한다: 공백 제거·소문자·'@' 포함·중복 제거. */
export function inviteEmailsToSend(emails: string[]): string[] {
    return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email && email.includes("@")))];
}

export interface InviteBatchResult {
    /** 이메일 → 초대 메일 발송 여부. 이전 시도에서 만든 초대를 포함한다. */
    created: Map<string, boolean>;
    failures: Array<{ email: string; error: unknown }>;
}

/**
 * 4단계 초대. 이미 만든 이메일은 다시 요청하지 않는다(같은 이메일 재초대는 서버가 막는다).
 * 한 건이 실패해도 나머지는 계속 보낸다.
 */
export async function createOnboardingInvites(
    emails: string[],
    alreadyCreated: ReadonlyMap<string, boolean>,
    request: OnboardingRequest = apiRequest,
): Promise<InviteBatchResult> {
    const created = new Map(alreadyCreated);
    const failures: InviteBatchResult["failures"] = [];
    for (const email of inviteEmailsToSend(emails)) {
        if (created.has(email)) continue;
        try {
            const result = await request<{ data: { emailSent?: boolean } }>("/api/org/invitations", json("POST", { email, role: "member" }));
            created.set(email, result.data.emailSent === true);
        } catch (error) {
            failures.push({ email, error });
        }
    }
    return { created, failures };
}

export function completeOnboarding(request: OnboardingRequest = apiRequest) {
    return request("/api/org/onboarding-complete", { method: "POST" });
}
