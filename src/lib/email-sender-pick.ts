/**
 * 발신 프로필·서명의 우선순위 판정 (순수 함수).
 *
 * DB를 모른다 — 조회는 email-sender-resolver.ts가 하고 여기는 "후보가 주어졌을 때
 * 무엇을 고를 것인가"만 결정한다. 테스트가 이 파일만 import하면 DB 커넥션이
 * 열리지 않으므로 분리해 두었다.
 */

export interface SenderCandidate {
    id: number;
    fromEmail: string;
    fromName: string;
    isDefault: boolean;
}

export interface SignatureCandidate {
    id: number;
    signature: string;
    isDefault: boolean;
}

/** 레거시 email_configs (프로필 테이블 도입 이전 org가 여기에만 발신자를 갖고 있다) */
export interface LegacyEmailConfig {
    fromEmail?: string | null;
    fromName?: string | null;
    signatureEnabled?: boolean | null;
    signature?: string | null;
}

export interface ResolvedSender {
    fromEmail: string | null;
    fromName?: string;
    /** 로그에 남길 값. 레거시 config로 떨어졌거나 미해결이면 null */
    profileId: number | null;
}

/**
 * preferredIds는 우선순위가 높은 순서다.
 *   수동 발송    [body.senderProfileId]
 *   AI 후속      [link.senderProfileId, parentLog.senderProfileId]
 *   템플릿 후속   [parentLog.senderProfileId]
 *
 * null/undefined 원소와 candidates에 없는 id(삭제됐거나 타 org)는 건너뛴다.
 * 덕분에 org 격리·구 로그 하위호환·프로필 삭제가 분기문 없이 같은 경로로 처리된다.
 */
export function pickSender(input: {
    preferredIds: ReadonlyArray<number | null | undefined>;
    candidates: ReadonlyArray<SenderCandidate>;
    config: LegacyEmailConfig | null;
}): ResolvedSender {
    const { preferredIds, candidates, config } = input;

    for (const id of preferredIds) {
        if (id === null || id === undefined) continue;
        const match = candidates.find((c) => c.id === id);
        if (match) return toResolved(match);
    }

    const defaultProfile = candidates.find((c) => c.isDefault);
    if (defaultProfile) return toResolved(defaultProfile);

    // 기본 프로필이 없을 때 아무 프로필이나 고르지 않는다 — 조용한 오배송이 된다
    if (config?.fromEmail) {
        return {
            fromEmail: config.fromEmail,
            fromName: config.fromName || undefined,
            profileId: null,
        };
    }

    return { fromEmail: null, profileId: null };
}

function toResolved(profile: SenderCandidate): ResolvedSender {
    return { fromEmail: profile.fromEmail, fromName: profile.fromName, profileId: profile.id };
}

/**
 * requestedId의 3-state가 계약의 핵심이다.
 *   number    → 그 서명. 삭제됐으면 기본 서명으로 fallback (서명은 fallback해도 오배송이 아니다)
 *   null      → 명시적 "서명 없음". fallback 금지
 *   undefined → 미지정. 기본 서명 → 레거시 config 순
 *
 * HTTP body에서 온 값은 이 구분이 사용자 선택이므로 중간에서 정규화하면 안 된다.
 * DB row에서 온 값(link.signatureId)만 `?? undefined`로 넘긴다 — DB의 null은 "미지정"이다.
 */
export function pickSignature(input: {
    requestedId: number | null | undefined;
    candidates: ReadonlyArray<SignatureCandidate>;
    config: LegacyEmailConfig | null;
}): string | null {
    const { requestedId, candidates, config } = input;

    if (requestedId === null) return null;

    if (requestedId !== undefined) {
        const match = candidates.find((c) => c.id === requestedId);
        if (match) return match.signature;
    }

    const defaultSig = candidates.find((c) => c.isDefault);
    if (defaultSig) return defaultSig.signature;

    if (config?.signatureEnabled && config?.signature) return config.signature;

    return null;
}
