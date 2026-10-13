/** 발송 후 이 시간 미만(음수 포함)의 클릭은 봇이다. 단위 ms. */
export const EARLY_CLICK_MS = 15_000;
/** 같은 발송의 이웃을 세는 ± 창. 단위 ms, 정각 포함. */
export const BURST_WINDOW_MS = 10_000;
export const BURST_MIN_NEIGHBORS = 2;
/** PostgreSQL ~*와 같은 패턴을 사용하며 SQL 테스트가 일치를 검증한다. */
export const BOT_UA_PATTERN =
    "curl|python|node-fetch|ruby|go-http|java/|guard|antispam|linker|scan|bot|spider|preview|headless|wget|okhttp|msie|^mozilla/5[.]0 chrome/";
const BOT_UA_RE = new RegExp(BOT_UA_PATTERN, "i");

export type BotReason = "ua" | "early" | "burst";
export interface BurstClick {
    id: number;
    sendLogId: number;
    clickedAt: Date;
    isBot: boolean;
}

/** 누락되거나 공백뿐인 UA도 봇으로 판정한다. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
    return userAgent == null || userAgent.trim() === "" || BOT_UA_RE.test(userAgent);
}

/** 음수 차이도 포함하며 정확히 15초인 클릭은 제외한다. */
export function isEarlyClick(sentAt: Date, clickedAt: Date): boolean {
    return clickedAt.getTime() - sentAt.getTime() < EARLY_CLICK_MS;
}

/** ua가 early보다 우선하며 두 규칙 모두 아니면 null이다. */
export function instantBotReason(input: {
    userAgent: string | null | undefined;
    sentAt: Date;
    clickedAt: Date;
}): "ua" | "early" | null {
    if (isBotUserAgent(input.userAgent)) return "ua";
    return isEarlyClick(input.sentAt, input.clickedAt) ? "early" : null;
}

/**
 * 같은 발송의 봇도 이웃으로 센다. 아직 봇이 아닌 id만 중복 없이 오름차순으로 반환한다.
 * 입력을 변경하지 않으며 발송별 정렬과 두 포인터로 O(n log n)에 판정한다.
 */
export function newBurstClickIds(clicks: readonly BurstClick[]): number[] {
    const groups = new Map<number, BurstClick[]>();
    for (const click of clicks) {
        const group = groups.get(click.sendLogId) ?? [];
        group.push(click);
        groups.set(click.sendLogId, group);
    }
    const ids = new Set<number>();
    for (const group of groups.values()) {
        group.sort((a, b) => a.clickedAt.getTime() - b.clickedAt.getTime());
        let left = 0;
        let right = 0;
        for (const click of group) {
            const time = click.clickedAt.getTime();
            while (group[left].clickedAt.getTime() < time - BURST_WINDOW_MS) left++;
            while (right < group.length && group[right].clickedAt.getTime() <= time + BURST_WINDOW_MS) right++;
            if (!click.isBot && right - left - 1 >= BURST_MIN_NEIGHBORS) ids.add(click.id);
        }
    }
    return [...ids].sort((a, b) => a - b);
}
