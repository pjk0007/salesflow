/**
 * 발송 경로가 발신 주소 한도 판정 결과를 다루는 규칙. DB를 모른다.
 *
 * 판정 자체(한도·웜업·시간대·간격)는 email-sender-limit-rules.ts, 자리 잡기는 email-sender-limit.ts에 있다.
 * 여기는 "막혔을 때 각 경로가 무엇을 하는가"만 둔다 — 후속 메일 발신 순서, 수동 발송의 묶음 중단과 안내 문구,
 * 대기열의 배치 사이 쉼. 테스트가 이 파일만 import하면 DB 커넥션이 열리지 않도록 분리해 두었다.
 * 설계: docs/2026-10-02-sender-warmup/DESIGN.md 6절.
 */

import { formatKstShort } from "@/lib/kst";
import { hasAnyLimit, linkSenderPool } from "@/lib/email-sender-limit-rules";
import type { SenderLimitSettings, SlotDeferReason } from "@/lib/email-sender-limit-rules";
import { pickSender } from "@/lib/email-sender-pick";
import type { LegacyEmailConfig, ResolvedSender, SenderCandidate } from "@/lib/email-sender-pick";

/**
 * 자리 잡기(claimSender)가 볼 후보 주소. 한도 판정·예약 전에 "어느 주소들을 볼지"만 정한다.
 * W1 — 한도를 하나도 켜지 않았으면 여기서 고른 주소가 예전 pickSender 결과와 같아야 한다.
 *
 *   pool   AI 첫 메일. ids 순서대로 이 조직 주소만 남긴다 (null·중복·없는 id는 뺀다 — 다른 조직·삭제된 id는
 *          profiles에 없어서 자연히 빠진다). 하나도 안 남으면 기본 주소 → 레거시 설정 (pickSender에 선호 id 없이)
 *   fixed  후속·템플릿·수동. pickSender 순서(선호 ids → 기본 → 레거시 설정)의 첫 주소 하나만
 *
 * 프로필이 아닌 발신자(레거시 설정, profileId null)나 보낼 주소가 아예 없으면 ResolvedSender를 그대로 돌려준다 —
 * 카운터가 없으니 예약 없이 통과한다. 배열이면 후보 주소 목록이다.
 */
export function pickSenderCandidates<T extends SenderCandidate>(
    profiles: readonly T[],
    opts: { mode: "pool" | "fixed"; ids: ReadonlyArray<number | null | undefined>; config: LegacyEmailConfig | null },
): T[] | ResolvedSender {
    if (opts.mode === "pool") {
        // 묶음 순서를 지킨다 — 쉰 시간이 같으면 앞 주소가 먼저다
        const byId = new Map(profiles.map((p) => [p.id, p]));
        const seen = new Set<number>();
        const pool: T[] = [];
        for (const id of opts.ids) {
            if (id === null || id === undefined || seen.has(id)) continue;
            const profile = byId.get(id);
            if (!profile) continue;
            seen.add(id);
            pool.push(profile);
        }
        if (pool.length > 0) return pool;
    }

    // fixed, 또는 묶음이 비었을 때: 지금까지와 같은 pickSender 순서 (선호 → 기본 → 레거시 설정).
    // 묶음이 비었으면 선호 id를 넘기지 않는다 — 넘겨도 profiles에 없는 id라 결과는 같지만, 뜻이 "기본 주소"임을 드러낸다
    const resolved = pickSender({
        preferredIds: opts.mode === "fixed" ? opts.ids : [],
        candidates: profiles,
        config: opts.config,
    });
    if (resolved.profileId === null) return resolved;
    const profile = profiles.find((p) => p.id === resolved.profileId);
    return profile ? [profile] : resolved;
}

/**
 * AI 후속 메일의 발신 주소 순서 (claimSender fixed 모드에 넘긴다).
 *
 * 첫 메일을 보낸 주소가 먼저다 — 같은 주소로 보내야 받는 쪽에서 같은 대화로 이어진다.
 * 그 주소가 지워졌거나 구 로그라 null이면 pickSender가 건너뛰어 규칙 묶음 → 기본 주소 순으로 흐른다.
 * fixed 모드라 첫 유효 주소 하나만 보고, 막히면 다른 주소로 넘기지 않고 그 주소가 열릴 때로 미룬다.
 * 실제 후속(email-followup.ts)과 테스트 후속(test-followup)이 같이 써야 테스트가 실제와 같은 주소로 나간다.
 */
export function followupSenderOrder(
    parentProfileId: number | null | undefined,
    link: { senderProfileId: number | null; senderProfileIds: number[] | null } | null | undefined,
): Array<number | null | undefined> {
    return [parentProfileId, ...(link ? linkSenderPool(link) : [])];
}

/**
 * 수동 발송에서 이 이유로 막히면 같은 요청의 남은 레코드도 똑같이 막힌다 — 주소 하나에 걸린 이유라서다.
 * 남은 레코드는 자리 잡기를 다시 하지 않고 같은 이유로 묶는다 (요청 하나에 최대 1000건이라 헛조회가 쌓인다).
 * 간격(spacing)은 요청이 도는 사이 간격이 지나 다시 열릴 수 있으므로 레코드마다 다시 본다.
 */
export function blocksRestOfBatch(reason: SlotDeferReason): boolean {
    return reason === "daily_limit" || reason === "paused" || reason === "outside_window";
}

/**
 * 수동 발송 결과에 레코드마다 붙일 사유. 화면이 같은 문구끼리 한 줄로 묶으므로
 * 같은 이유·같은 시각이면 문구가 같아야 한다. 정지는 풀릴 때를 모르므로 시각을 적지 않는다.
 */
export function describeLimitedSend(reason: SlotDeferReason, retryAt: Date): string {
    const at = formatKstShort(retryAt);
    switch (reason) {
        case "paused":
            return "발신 프로필이 일시 정지되어 있어 보내지 않았습니다.";
        case "outside_window":
            return `발신 프로필의 발송 시간대가 아니라 보내지 않았습니다 (${at}부터 보낼 수 있음).`;
        case "daily_limit":
            return `발신 프로필의 오늘 발송 한도를 다 써서 보내지 않았습니다 (${at}부터 보낼 수 있음).`;
        case "spacing":
            return `고르게 나눠 보내기 간격이 지나지 않아 보내지 않았습니다 (${at}부터 보낼 수 있음).`;
    }
}

/**
 * 대기열 한 배치가 미룸만 냈는가 (줄마다 미뤘으면 true). 그렇다면 배치 사이 1초를 쉬지 않는다 —
 * 미룸은 NHN을 부르지 않아 쉴 까닭이 없고, 한도에 닿은 뒤 쌓인 줄을 1초에 5건씩 미루면 8분 예산을 넘긴다.
 * 빈 배치는 false — 쉴지 말지가 아니라 회차를 끝낼 일이다.
 */
export function isDeferralOnlyBatch(deferred: readonly boolean[]): boolean {
    return deferred.length > 0 && deferred.every((d) => d);
}

// ============================================
// 발신 프로필 API의 관리자 확인 (주소 쪽)
// ============================================

/** 발신 주소 비교용. 저장도 이 모양으로 한다 (sender-profiles API가 trim·소문자로 저장) */
export function normalizeSenderAddress(email: string): string {
    return email.trim().toLowerCase();
}

export interface SenderProfileGuardInput {
    /** 고치거나 지우는 프로필. 새로 만들 때는 null */
    current: { fromEmail: string; limits: SenderLimitSettings } | null;
    /** 바꿀 주소. undefined면 주소를 바꾸지 않는다 */
    nextFromEmail: string | undefined;
    /** 같은 조직의 다른 프로필 (current 제외) */
    others: ReadonlyArray<{ fromEmail: string; limits: SenderLimitSettings }>;
}

/**
 * 한도 칸을 보내지 않아도 관리자 확인이 필요한 주소 변경인가. 필요하면 화면에 보일 이유, 아니면 null.
 *
 * 한도·사용량은 주소가 아니라 프로필 id에 걸린다. 그래서 멤버가 한도 칸 없이 할 수 있는 일로 관리자가 건
 * 한도를 피해 갈 수 있었다 — 같은 주소로 한도 없는 프로필을 하나 더 만들어 묶음에 넣기, 한도가 걸린 프로필의
 * 주소를 바꿔 다른 주소로 그 한도·웜업 날수를 옮기기. 이 둘은 관리자만 한다 (지우기는 senderProfileDeleteNeedsAdmin).
 * 한도가 하나도 없는 주소끼리는 예전처럼 누구나 만들고 바꾼다 — 기존 멤버 흐름을 깨지 않는다.
 */
export function senderProfileChangeNeedsAdmin(input: SenderProfileGuardInput): string | null {
    const { current, nextFromEmail, others } = input;
    if (nextFromEmail === undefined) return null;
    const next = normalizeSenderAddress(nextFromEmail);
    const changing = current === null || normalizeSenderAddress(current.fromEmail) !== next;
    if (!changing) return null;

    if (current && hasAnyLimit(current.limits)) {
        return "발송 한도가 걸린 발신 주소라 관리자만 주소를 바꿀 수 있습니다.";
    }
    if (others.some((o) => normalizeSenderAddress(o.fromEmail) === next && hasAnyLimit(o.limits))) {
        return "같은 주소에 관리자가 발송 한도를 걸어 두어, 이 주소로 발신 프로필을 더 만들거나 바꾸려면 관리자 권한이 필요합니다.";
    }
    return null;
}

/** 지울 때 관리자 확인이 필요한가 — 정지·한도가 걸린 주소를 지우면 그 주소만 묶은 규칙이 기본 주소로 흘러 바로 나간다 */
export function senderProfileDeleteNeedsAdmin(limits: SenderLimitSettings): string | null {
    return hasAnyLimit(limits) ? "발송 한도가 걸린 발신 주소라 관리자만 지울 수 있습니다." : null;
}

/**
 * 주소를 바꾸면 웜업을 처음(오늘 0일째)부터 다시 센다 — 새 주소는 아직 평판이 없다.
 * 바꾸지 않았거나 웜업이 꺼져 있으면 null (시작일을 건드리지 않는다).
 */
export function restartedWarmupStartedOn(
    currentFromEmail: string,
    nextFromEmail: string | undefined,
    limits: SenderLimitSettings,
    todayYmd: string,
): string | null {
    if (nextFromEmail === undefined || !limits.warmupEnabled) return null;
    if (normalizeSenderAddress(currentFromEmail) === normalizeSenderAddress(nextFromEmail)) return null;
    return todayYmd;
}

/**
 * 회차 안에서 "이 조직(키)의 발신 주소가 이 시각까지 막혔다"는 기록을 본다. 막혀 있으면 열리는 시각, 아니면 null.
 * 이미 열린 기록은 지운다. 반복 대기열이 같은 조직의 줄마다 조건·발송 준비 조회를 되풀이하지 않으려고 쓴다.
 */
export function activeBlock(blockedUntil: Map<string, Date>, key: string, now: Date): Date | null {
    const until = blockedUntil.get(key);
    if (!until) return null;
    if (until.getTime() <= now.getTime()) {
        blockedUntil.delete(key);
        return null;
    }
    return until;
}
