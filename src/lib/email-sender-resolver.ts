import { db, emailSenderProfiles, emailSignatures } from "@/lib/db";
import { eq } from "drizzle-orm";
import { pickSender, pickSignature } from "./email-sender-pick";
import type {
    SenderCandidate,
    SignatureCandidate,
    LegacyEmailConfig,
    ResolvedSender,
} from "./email-sender-pick";
import { toLimitSettings, normalizeSenderPool } from "./email-sender-limit-rules";
import type { SenderLimitSettings } from "./email-sender-limit-rules";

export type { SenderCandidate, SignatureCandidate, LegacyEmailConfig, ResolvedSender };
export { pickSender, pickSignature };

/** 조직의 발신 주소 하나. pickSender 후보이면서 한도 판정에 쓸 설정을 함께 갖는다 */
export interface OrgSenderProfile extends SenderCandidate {
    limits: SenderLimitSettings;
}

/**
 * 발신 주소 조회 칸. loadOrgSenderProfiles와 "주소 + 오늘 사용량" 한 번 조회(email-sender-limit.ts)가 같이 쓴다 —
 * 칸 목록이 두 벌이면 한쪽만 고쳐져 "고른 주소"와 "한도를 본 주소"가 어긋난다.
 */
export const senderProfileColumns = {
    id: emailSenderProfiles.id,
    fromEmail: emailSenderProfiles.fromEmail,
    fromName: emailSenderProfiles.fromName,
    isDefault: emailSenderProfiles.isDefault,
    dailyLimit: emailSenderProfiles.dailyLimit,
    warmupEnabled: emailSenderProfiles.warmupEnabled,
    warmupStartCount: emailSenderProfiles.warmupStartCount,
    warmupStep: emailSenderProfiles.warmupStep,
    warmupStartedOn: emailSenderProfiles.warmupStartedOn,
    sendWindowStart: emailSenderProfiles.sendWindowStart,
    sendWindowEnd: emailSenderProfiles.sendWindowEnd,
    weekdaysOnly: emailSenderProfiles.weekdaysOnly,
    spreadEvenly: emailSenderProfiles.spreadEvenly,
    isPaused: emailSenderProfiles.isPaused,
};

/** senderProfileColumns로 읽은 줄 (원래 칸 값 그대로) */
export type SenderProfileRow = Pick<typeof emailSenderProfiles.$inferSelect, keyof typeof senderProfileColumns>;

/**
 * 조직마다 마지막으로 읽은 발신 주소 줄 (이 프로세스 안). 고정 주소 한 문장 자리 잡기(email-sender-limit.ts)가 쓴다.
 * 낡아도 틀리지 않는다 — 그 문장이 쓸 때마다 DB의 지금 칸 값과 같은지 확인하고, 다르면 자리를 잡지 않는다.
 * 주소를 읽는 두 조회(loadOrgSenderProfiles·주소+사용량)가 채운다.
 */
const profileSnapshots = new Map<string, Map<number, SenderProfileRow>>();
/** 조직 수 상한 — 넘으면 가장 오래 넣은 조직부터 버린다 */
const PROFILE_SNAPSHOT_ORGS = 500;

export function rememberSenderProfileRows(orgId: string, rows: readonly SenderProfileRow[]): void {
    profileSnapshots.delete(orgId);
    profileSnapshots.set(orgId, new Map(rows.map((r) => [r.id, r])));
    while (profileSnapshots.size > PROFILE_SNAPSHOT_ORGS) {
        const oldest = profileSnapshots.keys().next();
        if (oldest.done) break;
        profileSnapshots.delete(oldest.value);
    }
}

/** 마지막으로 읽은 그 조직의 그 주소 줄 (없으면 undefined) */
export function rememberedSenderProfileRow(orgId: string, id: number): SenderProfileRow | undefined {
    return profileSnapshots.get(orgId)?.get(id);
}

/** senderProfileColumns로 읽은 줄 하나 → OrgSenderProfile */
export function toOrgSenderProfile(
    r: Pick<SenderCandidate, "id" | "fromEmail" | "fromName" | "isDefault"> &
        Partial<Record<keyof SenderLimitSettings, unknown>>
): OrgSenderProfile {
    return {
        id: r.id,
        fromEmail: r.fromEmail,
        fromName: r.fromName,
        isDefault: r.isDefault,
        limits: toLimitSettings(r),
    };
}

/**
 * 조직의 발신 주소 전부 (한도 칸 포함). resolveSender와 claimSender가 같이 쓴다 —
 * 조회가 두 벌이면 한쪽만 고쳐져 "고른 주소"와 "한도를 본 주소"가 어긋난다.
 * 순서(id 순)는 오늘 사용량을 함께 읽는 조회(loadSenderProfilesWithUsage)도 같아야 한다.
 */
export async function loadOrgSenderProfiles(orgId: string): Promise<OrgSenderProfile[]> {
    // is_default에 유니크 제약이 없어 기본 프로필이 여러 개일 수 있다.
    // orderBy 없이는 어느 행이 뽑히는지 비결정적이므로 id 순으로 고정한다.
    const rows = await db
        .select(senderProfileColumns)
        .from(emailSenderProfiles)
        .where(eq(emailSenderProfiles.orgId, orgId))
        .orderBy(emailSenderProfiles.id);

    rememberSenderProfileRows(orgId, rows);
    return rows.map(toOrgSenderProfile);
}

export type RuleSenderPoolResult =
    | { ok: true; value: { senderProfileId: number | null; senderProfileIds: number[] | null } | null }
    | { ok: false; error: string };

/**
 * AI 규칙 API 입력의 발신 주소 묶음을 검사해 저장할 두 칸을 만든다 (DESIGN 7절).
 *   senderProfileIds가 오면   → 그것을 쓰고 senderProfileId = ids[0] ?? null
 *   senderProfileId만 오면    → senderProfileIds = id ? [id] : null (예전 화면·MCP)
 *   둘 다 없으면              → value: null (두 칸을 건드리지 않는다)
 * 이 조직 주소가 아닌 id가 하나라도 있으면 거절한다 — 저장해 두면 발송 때 조용히 기본 주소로 흘러간다.
 */
export async function resolveRuleSenderPool(
    orgId: string,
    input: { senderProfileId?: unknown; senderProfileIds?: unknown }
): Promise<RuleSenderPoolResult> {
    let ids: number[] | null;
    if (input.senderProfileIds !== undefined) {
        const normalized = normalizeSenderPool(input.senderProfileIds);
        if (!normalized.ok) return { ok: false, error: normalized.error };
        ids = normalized.ids;
    } else if (input.senderProfileId !== undefined) {
        // 예전 경로는 숫자 문자열("3")도 그대로 저장했다 — 그 호출부가 400을 받지 않게 숫자로 읽어 준다
        const raw = input.senderProfileId;
        const single = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
        // "선택 안 함"은 null·0·""로 온다
        if (!single) {
            ids = null;
        } else {
            const normalized = normalizeSenderPool([single]);
            if (!normalized.ok) return { ok: false, error: normalized.error };
            ids = normalized.ids;
        }
    } else {
        return { ok: true, value: null };
    }

    if (ids && ids.length > 0) {
        const owned = new Set((await loadOrgSenderProfiles(orgId)).map((p) => p.id));
        if (ids.some((id) => !owned.has(id))) {
            return { ok: false, error: "선택한 발신 주소를 찾을 수 없습니다." };
        }
    }

    return {
        ok: true,
        value: { senderProfileId: ids?.[0] ?? null, senderProfileIds: ids && ids.length > 0 ? ids : null },
    };
}

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
    const candidates: SenderCandidate[] = await loadOrgSenderProfiles(orgId);

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
