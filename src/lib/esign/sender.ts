import { pickSender, type LegacyEmailConfig, type ResolvedSender, type SenderCandidate } from "../email-sender-pick";

/**
 * 계약 전용 주소는 그 주소를 등록한 조직에서만 쓴다. 등록하지 않은 조직은 자기 기본 발신자로 보낸다
 * (같은 조직 안에서만 고르므로 다른 브랜드 주소로 새지 않는다).
 */
export function selectEsignEmailSender(address: string | undefined, profiles: readonly SenderCandidate[], config: LegacyEmailConfig | null): ResolvedSender {
    const requested = address?.trim().toLowerCase();
    if (!requested) return pickSender({ preferredIds: [], candidates: profiles, config });
    const profile = profiles.find(candidate => candidate.fromEmail.trim().toLowerCase() === requested);
    if (profile) return pickSender({ preferredIds: [profile.id], candidates: profiles, config });
    if (config?.fromEmail?.trim().toLowerCase() === requested)
        return { fromEmail: config.fromEmail, fromName: config.fromName || undefined, profileId: null };
    return pickSender({ preferredIds: [], candidates: profiles, config });
}

/**
 * 고정 알림톡 발신 키(ESIGN_ALIMTALK_SENDER_KEY)는 소유 조직(ESIGN_ALIMTALK_SENDER_ORG_ID)에만 쓴다.
 * 소유 조직을 지정하지 않았으면 그 키가 이 조직의 기본 채널일 때만 쓴다. 그 밖의 조직은 자기 기본 채널을 쓴다.
 */
export function selectEsignAlimtalkSenderKey(input: { fixedKey?: string; fixedOrgId?: string; orgId: string; defaultSenderKey?: string | null }) {
    const fixed = input.fixedKey?.trim(), owner = input.fixedOrgId?.trim();
    if (fixed && (owner ? owner === input.orgId : fixed === input.defaultSenderKey)) return fixed;
    return input.defaultSenderKey || null;
}
