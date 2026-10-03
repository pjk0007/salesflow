/**
 * 발신 주소 자리 잡기 (DB). docs/2026-10-02-sender-warmup/DESIGN.md 5절.
 *
 * 판정 규칙(한도·웜업·시간대·간격·묶음 순번)은 email-sender-limit-rules.ts(순수)에 있고,
 * 여기는 "오늘 사용량을 읽고, 한 통 자리를 원자적으로 잡고, 못 보냈으면 돌려주는" 일만 한다.
 *
 * 사용량은 email_sender_daily_usage 카운터로만 센다 — 로그를 세지 않는다.
 * 자리는 발신자를 정하는 자리(AI 생성 전)에서 잡으므로, 막힌 메일에 토큰을 쓰지 않는다.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, emailSenderDailyUsage, emailSenderProfiles } from "@/lib/db";
import { kstParts } from "@/lib/kst";
import {
    loadOrgSenderProfiles,
    rememberSenderProfileRows,
    rememberedSenderProfileRow,
    senderProfileColumns,
    toOrgSenderProfile,
} from "@/lib/email-sender-resolver";
import type { LegacyEmailConfig, OrgSenderProfile, ResolvedSender, SenderProfileRow } from "@/lib/email-sender-resolver";
import { pickSenderCandidates } from "@/lib/email-sender-limit-paths";
import {
    DEFAULT_LIMIT_SETTINGS,
    capForDate,
    capSchedule,
    decideSlot,
    hasAnyLimit,
    isSendableNow,
    poolSpacingStepMs,
    rankPool,
    spreadGapMs,
    spreadSpacingRetry,
    warmupDayIndex,
} from "@/lib/email-sender-limit-rules";
import type { PoolCandidate, SlotDeferReason, SpacingSpreadMemo } from "@/lib/email-sender-limit-rules";

export interface SenderSlot {
    sender: ResolvedSender;
    /** 잡은 자리. null = 예약 없이 통과 (레거시 설정 발신자, 사용량 기록 실패를 넘긴 한도 없는 주소) */
    reservation: { profileId: number; usageDate: string } | null;
}

export type ClaimResult =
    | { ok: true; slot: SenderSlot }
    | { ok: false; retryAt: Date; reason: SlotDeferReason; profileId: number | null };

/** 설정 화면 미리보기 날수 */
const SCHEDULE_DAYS = 14;

/**
 * 경쟁에서 진 뒤 사용량을 다시 읽어 순번을 새로 매기는 최대 횟수.
 * 판정(rankPool)과 SQL 조건이 같은 식이라 보통 두 번째 회차에서 막힘으로 끝난다. 끝없이 돌지 않게 상한을 둔다.
 */
const MAX_CLAIM_ROUNDS = 3;

/** 회차를 다 쓰고도 자리를 못 잡았을 때 다시 해 볼 때까지의 간격 */
const CONTENDED_RETRY_MS = 60 * 1000;

type DayUsage = { sentToday: number; lastSentAt: Date | null };

const NO_USAGE: DayUsage = { sentToday: 0, lastSentAt: null };


/**
 * 메일 한 통을 보낼 발신 주소를 정하고 그 주소의 오늘 자리 하나를 잡는다.
 *
 *   pool   AI 첫 메일. ids 중 이 조직 주소 전부가 후보이고, 오늘 보낼 수 있는 주소 중 가장 오래 쉰 주소로 보낸다.
 *          하나도 없으면 pickSender 결과 하나 (기본 → 레거시 설정)
 *   fixed  후속·템플릿·수동. pickSender 순서의 첫 유효 주소 하나만 본다.
 *          막히면 다른 주소로 넘기지 않고 그 주소가 열리는 시각으로 미룬다 (같은 대화로 이어지게)
 *
 * 레거시 설정 발신자(profileId: null)는 카운터가 없으므로 예약 없이 통과한다.
 * 잡은 자리는 sendEachMail을 부르기 전 실패·NHN isSuccessful:false 때 releaseSenderSlot으로 돌려준다.
 *
 * spreadDeferrals: 간격(spacing)으로 막혔을 때 같은 묶음·같은 retryAt으로 미뤄지는 메일을 순번 × 묶음 간격으로 펼친다.
 * 대기열로 다시 시도하는 경로(대기열·바로 보내는 AI·후속·템플릿)가 켠다 — 안 펼치면 밀린 줄 전부가 간격마다 한꺼번에
 * 깨어나 한 통만 나가고 다시 미뤄진다. 수동 발송은 안내 문구에 실제로 열리는 시각을 보여야 하므로 켜지 않는다.
 */
export async function claimSender(
    orgId: string,
    opts: {
        mode: "pool" | "fixed";
        ids: ReadonlyArray<number | null | undefined>;
        config: LegacyEmailConfig | null;
        now?: Date;
        spreadDeferrals?: boolean;
    }
): Promise<ClaimResult> {
    const now = opts.now ?? new Date();
    // 날짜 키는 한 번만 계산해 판정과 SQL에 같이 쓴다 — 자정 경계에서 둘이 다른 날을 보지 않게
    const usageDate = kstParts(now).date;

    // 고정 주소면 먼저 한 문장으로 자리를 잡아 본다 (주소 설정 확인 + 예약). 못 잡으면 아래 원래 흐름 그대로
    const fast = await reserveFixedInOneStatement(orgId, opts, now, usageDate);
    if (fast) return fast;

    // 주소와 오늘 사용량을 한 문장으로 읽는다 (예전: 주소 1 + 사용량 1)
    const loaded = await loadProfilesAndUsage(orgId, usageDate);
    const picked = pickSenderCandidates(loaded.profiles, opts);
    if (!Array.isArray(picked)) {
        return { ok: true, slot: { sender: picked, reservation: null } };
    }
    const candidates = picked;
    const byId = new Map(candidates.map((p) => [p.id, p]));
    // 한도가 하나도 없는 주소만 남았으면 카운터는 기록일 뿐이다 — 카운터가 실패해도 지금처럼 보낸다
    const anyLimited = candidates.some((p) => hasAnyLimit(p.limits));

    for (let round = 0; round < MAX_CLAIM_ROUNDS; round++) {
        // 첫 회차는 주소와 함께 읽은 사용량을 쓴다. 경쟁에서 진 뒤(다음 회차)에는 예전처럼 사용량만 다시 읽는다
        const usage =
            round === 0 && loaded.usage ? loaded.usage : await readUsageTolerant(candidates, usageDate, anyLimited);
        const pool = toPoolCandidates(candidates, usage);

        const rank = rankPool(pool, now);
        if (!rank.ok) {
            return {
                ok: false,
                retryAt: opts.spreadDeferrals ? spreadIfSpacing(pool, now, rank.retryAt, rank.reason) : rank.retryAt,
                reason: rank.reason,
                profileId: blockingProfileId(pool, now, rank.retryAt, rank.reason),
            };
        }

        for (const id of rank.order) {
            const profile = byId.get(id);
            if (!profile) continue;
            const reserved = await reserveSlot(profile, usageDate, now);
            if (reserved === "lost") continue; // 경쟁에서 졌다 — 다음 후보로
            return {
                ok: true,
                slot: {
                    sender: toResolvedSender(profile),
                    reservation: reserved === "reserved" ? { profileId: profile.id, usageDate } : null,
                },
            };
        }
        // 이번 순번의 후보를 전부 놓쳤다 → 사용량을 다시 읽어 판정부터 다시 (retryAt도 새 값으로 나온다)
    }

    console.warn(`[sender-limit] org ${orgId}: ${MAX_CLAIM_ROUNDS}회 연속 자리 경쟁에서 짐, 잠시 뒤로 미룸`);
    return {
        ok: false,
        retryAt: new Date(now.getTime() + CONTENDED_RETRY_MS),
        reason: "spacing",
        profileId: candidates.length === 1 ? candidates[0].id : null,
    };
}

export type PoolBlockState =
    | { blocked: false }
    | {
          blocked: true;
          reason: SlotDeferReason;
          /** 그 retryAt을 만든 주소 (claimSender의 profileId와 같다) */
          profileId: number | null;
          /** 이 묶음으로 claimSender를 지금 부르면 돌려줄 retryAt. 미룰 줄마다 한 번씩, 처리 순서대로 부른다 */
          nextRetryAt: () => Date;
      };

/**
 * 묶음 여러 개가 지금 막혔는지 claimSender와 같은 재료·같은 판정으로 한 번에 본다. 자리를 잡지 않는다 (DB에 쓰지 않는다).
 * 대기열 워커가 같은 묶음에 막힌 줄을 한꺼번에 미룰 때 쓴다 — 줄마다 claimSender를 부르면 줄마다 주소·사용량을 읽는다.
 *
 * blocked = 지금 claimSender(orgId, { mode: "pool", ids, config, spreadDeferrals })가 첫 회차에서 { ok: false }로 끝나는 경우:
 * 같은 조회(주소 + 오늘 사용량) → pickSenderCandidates → rankPool이 통과 주소 없이 막힘. 이때 claimSender도 자리를
 * 잡으러 가지 않아 DB에 쓰지 않는다. nextRetryAt()은 그 호출이 돌려줄 retryAt이다 — spreadDeferrals면 간격 미룸을
 * claimSender와 같은 기록(spacingSpreadMemo)으로 한 번 펼친다. 그래서 N줄에 N번 부르면 claimSender를 N번 부른 것과 같다.
 * 통과할 주소가 하나라도 있거나 레거시 설정 발신자면 { blocked: false } — 그 줄은 claimSender를 실제로 불러야 한다.
 */
export async function checkPoolsBlocked(
    orgId: string,
    pools: ReadonlyArray<ReadonlyArray<number | null | undefined>>,
    opts: { config: LegacyEmailConfig | null; now?: Date; spreadDeferrals?: boolean }
): Promise<PoolBlockState[]> {
    const now = opts.now ?? new Date();
    const usageDate = kstParts(now).date;
    const loaded = await loadProfilesAndUsage(orgId, usageDate);

    const out: PoolBlockState[] = [];
    for (const ids of pools) {
        const picked = pickSenderCandidates(loaded.profiles, { mode: "pool", ids, config: opts.config });
        if (!Array.isArray(picked)) {
            out.push({ blocked: false });
            continue;
        }
        const anyLimited = picked.some((p) => hasAnyLimit(p.limits));
        const usage = loaded.usage ?? (await readUsageTolerant(picked, usageDate, anyLimited));
        const pool = toPoolCandidates(picked, usage);
        const rank = rankPool(pool, now);
        if (rank.ok) {
            out.push({ blocked: false });
            continue;
        }
        const { retryAt, reason } = rank;
        out.push({
            blocked: true,
            reason,
            profileId: blockingProfileId(pool, now, retryAt, reason),
            nextRetryAt: () =>
                opts.spreadDeferrals ? spreadIfSpacing(pool, now, retryAt, reason) : new Date(retryAt.getTime()),
        });
    }
    return out;
}

/**
 * 잡은 자리를 돌려준다. 던지지 않는다 — 발송 실패를 처리하는 중에 불리므로 여기서 던지면 원래 오류가 묻힌다.
 *
 * 반드시 예약한 날짜로 되돌린다 (자정을 넘긴 뒤 돌려줘도 그날 값이 줄어야 한다).
 * last_sent_at은 되돌리지 않는다 — 이전 값을 모르고, 늦게 보내는 쪽으로만 틀어지므로 안전하다.
 * 같은 slot을 두 번 넘겨도 한 번만 돌려준다 (실패 분기와 catch가 함께 부르는 호출부가 있다).
 */
export async function releaseSenderSlot(slot: SenderSlot | null | undefined): Promise<void> {
    const reservation = slot?.reservation;
    if (!slot || !reservation) return;
    slot.reservation = null;
    try {
        await db
            .update(emailSenderDailyUsage)
            .set({ sentCount: sql`${emailSenderDailyUsage.sentCount} - 1` })
            .where(
                and(
                    eq(emailSenderDailyUsage.senderProfileId, reservation.profileId),
                    eq(emailSenderDailyUsage.usageDate, reservation.usageDate),
                    gt(emailSenderDailyUsage.sentCount, 0)
                )
            );
    } catch (error) {
        console.error(
            `[sender-limit] 자리 반환 실패 (profile ${reservation.profileId}, ${reservation.usageDate}):`,
            error
        );
    }
}

export interface SenderUsageView {
    profileId: number;
    usageDate: string;
    sentToday: number;
    cap: number | null;
    /** 웜업 며칠째 (시작일 = 0). 웜업이 꺼져 있으면 null */
    warmupDay: number | null;
    schedule: Array<{ date: string; cap: number | null }>;
}

/** 주소별 오늘 사용량·오늘 한도·웜업 날수·앞으로 14일 한도 (설정 화면용) */
export async function getSenderUsage(orgId: string, now: Date = new Date()): Promise<SenderUsageView[]> {
    const usageDate = kstParts(now).date;
    const loaded = await loadProfilesAndUsage(orgId, usageDate);
    const profiles = loaded.profiles;
    if (profiles.length === 0) return [];

    // 한 번 조회가 실패해 나눠 읽었을 때만 사용량을 따로 읽는다 (예전처럼 실패하면 던진다)
    const usage =
        loaded.usage ??
        (await readUsage(
            profiles.map((p) => p.id),
            usageDate
        ));

    return profiles.map((p) => ({
        profileId: p.id,
        usageDate,
        sentToday: usage.get(p.id)?.sentToday ?? 0,
        cap: capForDate(p.limits, usageDate),
        warmupDay: p.limits.warmupEnabled ? warmupDayIndex(p.limits, usageDate) : null,
        schedule: capSchedule(p.limits, usageDate, SCHEDULE_DAYS),
    }));
}

/**
 * 요청 본문에서 한도 칸만 골라낸다. 하나도 없으면 null.
 * 발신 주소 API가 "한도 칸이 있을 때만 관리자 확인"을 하려고 쓴다 — 이름·주소만 고치는 예전 화면은 그대로 둔다.
 */
export function pickLimitPatch(body: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!body || typeof body !== "object") return null;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_LIMIT_SETTINGS)) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

// ============================================
// 내부
// ============================================

function toResolvedSender(profile: OrgSenderProfile): ResolvedSender {
    return { fromEmail: profile.fromEmail, fromName: profile.fromName, profileId: profile.id };
}

function toPoolCandidates(candidates: readonly OrgSenderProfile[], usage: Map<number, DayUsage>): PoolCandidate[] {
    return candidates.map((p) => ({
        id: p.id,
        settings: p.limits,
        usage: usage.get(p.id) ?? NO_USAGE,
    }));
}

/**
 * 조직의 발신 주소와 그 주소들의 usageDate 사용량을 한 문장으로 읽는다 (주소 id 순 — loadOrgSenderProfiles와 같다).
 * 그날 줄이 없는 주소는 usage에 넣지 않는다 — readUsage와 같이 NO_USAGE로 본다.
 *
 * 실패하면 예전 두 단계로 돌아간다: 주소만 다시 읽고(실패하면 예전처럼 던진다) usage는 null로 준다.
 * 그러면 호출한 쪽이 readUsage·readUsageTolerant로 사용량을 따로 읽는다 — 사용량 표만 문제일 때 한도 없는 주소는
 * 그대로 보내던 동작(readUsageTolerant)을 지키려는 것이다.
 */
async function loadProfilesAndUsage(
    orgId: string,
    usageDate: string
): Promise<{ profiles: OrgSenderProfile[]; usage: Map<number, DayUsage> | null }> {
    let rows;
    try {
        rows = await db
            .select({
                ...senderProfileColumns,
                usageSentCount: emailSenderDailyUsage.sentCount,
                usageLastSentAt: emailSenderDailyUsage.lastSentAt,
            })
            .from(emailSenderProfiles)
            .leftJoin(
                emailSenderDailyUsage,
                and(
                    eq(emailSenderDailyUsage.senderProfileId, emailSenderProfiles.id),
                    eq(emailSenderDailyUsage.usageDate, usageDate)
                )
            )
            .where(eq(emailSenderProfiles.orgId, orgId))
            .orderBy(emailSenderProfiles.id);
    } catch (error) {
        console.error("[sender-limit] 주소·사용량 한 번 조회 실패 — 나눠서 다시 읽음:", error);
        return { profiles: await loadOrgSenderProfiles(orgId), usage: null };
    }

    const usage = new Map<number, DayUsage>();
    const profileRows: SenderProfileRow[] = [];
    for (const { usageSentCount, usageLastSentAt, ...profileRow } of rows) {
        // (주소, 날짜)가 기본 키라 주소마다 많아야 한 줄이다
        if (usageSentCount !== null) {
            usage.set(profileRow.id, { sentToday: usageSentCount, lastSentAt: usageLastSentAt });
        }
        profileRows.push(profileRow);
    }
    rememberSenderProfileRows(orgId, profileRows);
    return { profiles: profileRows.map(toOrgSenderProfile), usage };
}

/**
 * 고정 주소(fixed)의 자리를 한 문장으로 잡는다 — 주소·사용량 조회 없이. 잡으면 결과, 아니면 null (원래 흐름으로).
 *
 * 원래 흐름과 같은 결과인 까닭:
 *   주소 고르기  fixed는 ids의 첫 id가 이 조직 주소면 그 주소다 (pickSenderCandidates → pickSender). 문장 안에서
 *              그 id가 이 조직 주소이고 판정에 쓰는 칸(주소·이름·한도·웜업·시간대·요일·고르게·정지)이 기억한 값과
 *              모두 같을 때만 예약한다 — 다르면(설정이 바뀌었거나 지워졌다) 아무것도 쓰지 않고 null.
 *   판정        정지·시간대·요일은 그 칸 값으로 여기서 본다 (decideSlot과 같은 함수). 오늘 한도는 예약 문장의
 *              조건(sent_count < cap)이 사용량을 잠근 채 본다 — 원래 흐름의 판정(sentToday < cap)과 같은 식이다.
 * 원래 흐름보다 막히기 쉬운 경우만 쓴다: 간격(고르게 나눠 보내기)이 걸린 주소는 자주 막혀 헛문장이 늘므로 쓰지 않고,
 * 오늘 한도가 0이면(예약 문장의 첫 insert는 한도를 보지 않는다) 쓰지 않는다. 막혔으면 원래 흐름이 같은 retryAt을 만든다.
 * 오류가 나면 null — 원래 흐름이 오류를 예전처럼 다룬다 (한도 없는 주소는 기록 실패를 넘긴다).
 */
async function reserveFixedInOneStatement(
    orgId: string,
    opts: { mode: "pool" | "fixed"; ids: ReadonlyArray<number | null | undefined> },
    now: Date,
    usageDate: string
): Promise<ClaimResult | null> {
    if (opts.mode !== "fixed") return null;
    const firstId = opts.ids.find((id) => id !== null && id !== undefined);
    if (firstId === null || firstId === undefined) return null;
    const row = rememberedSenderProfileRow(orgId, firstId);
    if (!row) return null;

    const profile = toOrgSenderProfile(row);
    const s = profile.limits;
    if (s.isPaused || !isSendableNow(s, now)) return null;
    const cap = capForDate(s, usageDate);
    if (cap !== null && cap < 1) return null;
    if (spreadGapMs(s, cap) > 0) return null;

    // db.execute에서는 drizzle이 시각 직렬화를 꺼 두므로 ISO 문자열로 넘기고 형을 붙인다
    const nowIso = now.toISOString();
    try {
        const rows = (await db.execute(sql`
            INSERT INTO email_sender_daily_usage AS u (sender_profile_id, usage_date, sent_count, last_sent_at)
            SELECT ${row.id}::int, ${usageDate}::varchar, 1, ${nowIso}::timestamptz
            WHERE EXISTS (
                SELECT 1 FROM email_sender_profiles p
                WHERE p.id = ${row.id}::int
                  AND p.org_id = ${orgId}::uuid
                  AND p.from_email = ${row.fromEmail}::varchar
                  AND p.from_name = ${row.fromName}::varchar
                  AND p.daily_limit IS NOT DISTINCT FROM ${row.dailyLimit}::int
                  AND p.warmup_enabled = ${row.warmupEnabled}::boolean
                  AND p.warmup_start_count IS NOT DISTINCT FROM ${row.warmupStartCount}::int
                  AND p.warmup_step IS NOT DISTINCT FROM ${row.warmupStep}::int
                  AND p.warmup_started_on IS NOT DISTINCT FROM ${row.warmupStartedOn}::varchar
                  AND p.send_window_start IS NOT DISTINCT FROM ${row.sendWindowStart}::int
                  AND p.send_window_end IS NOT DISTINCT FROM ${row.sendWindowEnd}::int
                  AND p.weekdays_only = ${row.weekdaysOnly}::boolean
                  AND p.spread_evenly = ${row.spreadEvenly}::boolean
                  AND p.is_paused = ${row.isPaused}::boolean
            )
            ON CONFLICT (sender_profile_id, usage_date) DO UPDATE
               SET sent_count = u.sent_count + 1, last_sent_at = EXCLUDED.last_sent_at
             WHERE (${cap}::int IS NULL OR u.sent_count < ${cap}::int)
            RETURNING sent_count
        `)) as unknown as Array<{ sent_count: number }>;
        if (rows.length === 0) return null;
    } catch (error) {
        console.error(`[sender-limit] 한 문장 자리 잡기 실패 (profile ${row.id}) — 원래 흐름으로:`, error);
        return null;
    }
    return {
        ok: true,
        slot: { sender: toResolvedSender(profile), reservation: { profileId: profile.id, usageDate } },
    };
}

async function readUsage(profileIds: number[], usageDate: string): Promise<Map<number, DayUsage>> {
    const usage = new Map<number, DayUsage>();
    if (profileIds.length === 0) return usage;
    const rows = await db
        .select({
            senderProfileId: emailSenderDailyUsage.senderProfileId,
            sentCount: emailSenderDailyUsage.sentCount,
            lastSentAt: emailSenderDailyUsage.lastSentAt,
        })
        .from(emailSenderDailyUsage)
        .where(
            and(
                eq(emailSenderDailyUsage.usageDate, usageDate),
                inArray(emailSenderDailyUsage.senderProfileId, profileIds)
            )
        );
    for (const r of rows) {
        usage.set(r.senderProfileId, { sentToday: r.sentCount, lastSentAt: r.lastSentAt });
    }
    return usage;
}

/** 한도 있는 후보가 있으면 사용량 조회 실패를 그대로 던진다 — 모르는 채로 보내면 한도가 깨진다 */
async function readUsageTolerant(
    candidates: OrgSenderProfile[],
    usageDate: string,
    anyLimited: boolean
): Promise<Map<number, DayUsage>> {
    try {
        return await readUsage(
            candidates.map((p) => p.id),
            usageDate
        );
    } catch (error) {
        if (anyLimited) throw error;
        console.error("[sender-limit] 사용량 조회 실패 — 한도 없는 주소라 그대로 보냄:", error);
        return new Map();
    }
}

/**
 * 오늘 자리 하나를 원자적으로 잡는다. 한 문장 = 한 트랜잭션.
 *
 * ON CONFLICT DO UPDATE는 겹친 줄을 잠근 뒤 최신 커밋 값으로 WHERE를 다시 본다 —
 * 그래서 같은 (주소, 날짜)의 동시 예약은 한 줄로 줄 서고 한도·간격을 넘지 않는다.
 * 그날 첫 insert가 겹치면 뒤쪽은 PK에서 기다렸다가 UPDATE 쪽으로 간다.
 *
 *   reserved    잡았다
 *   lost        조건(한도·간격)에 걸렸다 — 판정 뒤 다른 워커가 먼저 잡았다
 *   unrecorded  카운터 쓰기가 실패했지만 한도 없는 주소라 그대로 보낸다
 */
async function reserveSlot(
    profile: OrgSenderProfile,
    usageDate: string,
    now: Date
): Promise<"reserved" | "lost" | "unrecorded"> {
    const cap = capForDate(profile.limits, usageDate);
    const gapMs = spreadGapMs(profile.limits, cap);
    // db.execute에서는 drizzle이 시각 직렬화를 꺼 두므로 ISO 문자열로 넘기고 형을 붙인다
    const nowIso = now.toISOString();

    try {
        const rows = (await db.execute(sql`
            INSERT INTO email_sender_daily_usage AS u (sender_profile_id, usage_date, sent_count, last_sent_at)
            VALUES (${profile.id}, ${usageDate}, 1, ${nowIso}::timestamptz)
            ON CONFLICT (sender_profile_id, usage_date) DO UPDATE
               SET sent_count = u.sent_count + 1, last_sent_at = EXCLUDED.last_sent_at
             WHERE (${cap}::int IS NULL OR u.sent_count < ${cap}::int)
               AND (${gapMs}::bigint = 0 OR u.last_sent_at IS NULL
                    OR u.last_sent_at <= ${nowIso}::timestamptz - ${gapMs}::bigint * INTERVAL '1 millisecond')
            RETURNING sent_count
        `)) as unknown as Array<{ sent_count: number }>;
        return rows.length > 0 ? "reserved" : "lost";
    } catch (error) {
        // 한도 없는 주소의 카운터는 화면 표시·묶음 순번용 기록이다 — 기록 실패로 발송을 멈추지 않는다
        if (hasAnyLimit(profile.limits)) throw error;
        console.error(`[sender-limit] 사용량 기록 실패 (profile ${profile.id}) — 한도 없는 주소라 그대로 보냄:`, error);
        return "unrecorded";
    }
}

/**
 * 간격 미룸 펼치기 기록 (이 프로세스 안에서만). 키는 묶음 주소 id들 + retryAt.
 * 지난 retryAt의 기록은 spreadSpacingRetry가 부를 때마다 버리므로 쌓이지 않는다.
 */
const spacingSpreadMemo: SpacingSpreadMemo = new Map();

/** 간격으로 막혔으면 묶음 순번만큼 retryAt을 뒤로 펼친다. 다른 이유면 그대로 */
function spreadIfSpacing(pool: readonly PoolCandidate[], now: Date, retryAt: Date, reason: SlotDeferReason): Date {
    if (reason !== "spacing") return retryAt;
    const stepMs = poolSpacingStepMs(pool, now);
    if (stepMs <= 0) return retryAt;
    const poolKey = [...new Set(pool.map((c) => c.id))].sort((a, b) => a - b).join(",");
    return spreadSpacingRetry(spacingSpreadMemo, poolKey, retryAt, stepMs, now);
}

/** 묶음 전부가 막혔을 때 그 retryAt을 만든 주소. 로그·수동 발송 안내용 */
function blockingProfileId(
    pool: readonly PoolCandidate[],
    now: Date,
    retryAt: Date,
    reason: SlotDeferReason
): number | null {
    if (pool.length === 1) return pool[0].id;
    for (const c of pool) {
        const decision = decideSlot(c.settings, now, c.usage);
        if (!decision.ok && decision.reason === reason && decision.retryAt.getTime() === retryAt.getTime()) {
            return c.id;
        }
    }
    return null;
}
