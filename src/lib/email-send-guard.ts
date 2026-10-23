import { normalizeEmail } from "./deep-visitor-alert-rules";

/** Final transport check. No DB or provider dependency, so it can be verified without sending mail. */
export const EMAIL_SEND_BLOCKED = -7101;
export const EMAIL_SEND_CHECK_FAILED = -7102;
export const EMAIL_SEND_INVALID_CONTEXT = -7103;

export type EmailSuppressionLookup = (orgId: string, email: string) => Promise<boolean>;
export type EmailSendRejection = {
    header: { isSuccessful: false; resultCode: number; resultMessage: string };
    data: null;
};
export type EmailSendDecision =
    | { allowed: true; recipients: string[] }
    | { allowed: false; rejection: EmailSendRejection };

function reject(resultCode: number, resultMessage: string): EmailSendDecision {
    return { allowed: false, rejection: { header: { isSuccessful: false, resultCode, resultMessage }, data: null } };
}

/** One blocked recipient stops the whole request, including a mixed To/Cc submission. */
export async function checkEmailSubmission(
    orgId: string | undefined,
    recipients: readonly string[],
    lookup: EmailSuppressionLookup,
): Promise<EmailSendDecision> {
    if (!orgId?.trim() || !recipients.length)
        return reject(EMAIL_SEND_INVALID_CONTEXT, "발송 조직 또는 수신자를 확인할 수 없어 메일을 보내지 않았습니다.");
    const normalized = recipients.map((email) => typeof email === "string" ? normalizeEmail(email) : "");
    if (normalized.some((email) => email.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+$/.test(email)))
        return reject(EMAIL_SEND_INVALID_CONTEXT, "받는 이메일 주소가 올바르지 않아 메일을 보내지 않았습니다.");
    try {
        for (const email of new Set(normalized)) {
            if (await lookup(orgId, email))
                return reject(EMAIL_SEND_BLOCKED, "이 조직의 수신거부 목록에 등록된 주소가 있어 메일을 보내지 않았습니다.");
        }
    } catch {
        // An outage must never turn into permission to send. Do not expose DB errors or addresses.
        return reject(EMAIL_SEND_CHECK_FAILED, "수신거부 여부를 확인하지 못해 메일을 보내지 않았습니다. 잠시 후 다시 시도해주세요.");
    }
    return { allowed: true, recipients: normalized };
}

export async function submitEmailWithGuard<T>(
    orgId: string | undefined,
    recipients: readonly string[],
    lookup: EmailSuppressionLookup,
    submit: (normalizedRecipients: string[]) => Promise<T>,
): Promise<T | EmailSendRejection> {
    const decision = await checkEmailSubmission(orgId, recipients, lookup);
    return decision.allowed ? submit(decision.recipients) : decision.rejection;
}
