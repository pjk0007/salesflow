import { db, emailSenderProfiles, emailSignatures } from "@/lib/db";
import { eq } from "drizzle-orm";
import { pickSender, pickSignature } from "./email-sender-pick";
import type {
    SenderCandidate,
    SignatureCandidate,
    LegacyEmailConfig,
    ResolvedSender,
} from "./email-sender-pick";

export type { SenderCandidate, SignatureCandidate, LegacyEmailConfig, ResolvedSender };
export { pickSender, pickSignature };

export interface ResolveSenderOpts {
    /** 우선순위가 높은 순서의 후보 ID. 비었거나 전부 null이면 기본 프로필부터 본다 */
    preferredIds?: ReadonlyArray<number | null | undefined>;
    /**
     * 레거시 email_configs. optional로 두지 않는다 — 넘기는 걸 잊으면
     * 프로필 테이블 없이 email_configs만 쓰는 org의 발송이 조용히 죽는다.
     * 넘길 게 없으면 null을 명시할 것.
     */
    config: LegacyEmailConfig | null;
}

/**
 * 발신 프로필 결정. org의 프로필을 한 번에 조회해 pickSender에 넘긴다.
 * preferredIds에 있어도 이 org 소유가 아니면 조회 결과에 없으므로 자동으로 다음 후보로 흐른다.
 */
export async function resolveSender(
    orgId: string,
    opts: ResolveSenderOpts
): Promise<ResolvedSender> {
    // is_default에 유니크 제약이 없어 기본 프로필이 여러 개일 수 있다.
    // orderBy 없이는 어느 행이 뽑히는지 비결정적이므로 id 순으로 고정한다.
    const rows = await db
        .select({
            id: emailSenderProfiles.id,
            fromEmail: emailSenderProfiles.fromEmail,
            fromName: emailSenderProfiles.fromName,
            isDefault: emailSenderProfiles.isDefault,
        })
        .from(emailSenderProfiles)
        .where(eq(emailSenderProfiles.orgId, orgId))
        .orderBy(emailSenderProfiles.id);

    const candidates: SenderCandidate[] = rows.map((r) => ({
        id: r.id,
        fromEmail: r.fromEmail,
        fromName: r.fromName,
        isDefault: r.isDefault,
    }));

    return pickSender({
        preferredIds: opts.preferredIds ?? [],
        candidates,
        config: opts.config,
    });
}

export interface ResolveSignatureOpts {
    /** null은 "서명 없음" 확정, undefined(키 부재)는 "미지정 → 기본값" */
    requestedId?: number | null;
    config: LegacyEmailConfig | null;
}

export async function resolveSignature(
    orgId: string,
    opts: ResolveSignatureOpts
): Promise<string | null> {
    const rows = await db
        .select({
            id: emailSignatures.id,
            signature: emailSignatures.signature,
            isDefault: emailSignatures.isDefault,
        })
        .from(emailSignatures)
        .where(eq(emailSignatures.orgId, orgId))
        .orderBy(emailSignatures.id);

    const candidates: SignatureCandidate[] = rows.map((r) => ({
        id: r.id,
        signature: r.signature,
        isDefault: r.isDefault,
    }));

    return pickSignature({
        // pickSignature가 null(서명 없음)과 undefined(미지정)를 값으로 구분한다
        requestedId: opts.requestedId,
        candidates,
        config: opts.config,
    });
}

/** @deprecated resolveSender를 직접 쓸 것. 기존 호출부 호환용 래퍼 */
export async function resolveDefaultSender(
    orgId: string,
    fallbackConfig?: LegacyEmailConfig | null
): Promise<{ fromEmail: string | null; fromName?: string }> {
    const { fromEmail, fromName } = await resolveSender(orgId, {
        config: fallbackConfig ?? null,
    });
    return { fromEmail, fromName };
}

/** @deprecated resolveSignature를 직접 쓸 것. 기존 호출부 호환용 래퍼 */
export async function resolveDefaultSignature(
    orgId: string,
    fallbackConfig?: LegacyEmailConfig | null
): Promise<string | null> {
    // requestedId를 넘기지 않는다 — null을 넘기면 기존 경로의 서명이 전부 사라진다
    return resolveSignature(orgId, { config: fallbackConfig ?? null });
}
