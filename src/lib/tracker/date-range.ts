/**
 * 트래커 분석의 조회 기간 처리.
 *
 * 웹 route 4곳(funnel·overview·engagement·ad-performance)에 같은 구현이 중복돼 있었다.
 * MCP 툴이 웹과 같은 수치를 내려면 규약이 한 글자도 달라선 안 되므로 여기로 모은다.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 기본 조회 기간(일). 웹 route 4곳이 동일하게 30일을 쓴다. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * Date → "YYYY-MM-DD".
 *
 * UTC 기준이라 KST 오전 9시 이전에는 "어제"가 나온다. 기존 웹 route가 전부 이렇게
 * 동작하므로 그대로 옮긴다 — 여기서 고치면 웹 수치가 바뀐다.
 */
function ymd(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * from/to(YYYY-MM-DD, 둘 다 optional)를 정규화한다.
 *
 * now를 인자로 받는 것은 테스트를 위해서다 — Date.now()에 의존하면 기본값 계약을
 * 고정할 수 없다.
 */
export function resolveRange(
    from: string | null | undefined,
    to: string | null | undefined,
    now: Date = new Date()
): { fromYmd: string; toYmd: string } {
    const toYmd = to && to.length > 0 ? to : ymd(now);
    const fromYmd =
        from && from.length > 0 ? from : ymd(new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS));
    return { fromYmd, toYmd };
}

/** KST 자정 기준 ISO 경계. 웹 route에 중복 정의돼 있던 rangeBounds와 동일. */
export function rangeBounds(fromYmd: string, toYmd: string): { fromIso: string; toIso: string } {
    return {
        fromIso: `${fromYmd}T00:00:00+09:00`,
        toIso: `${toYmd}T23:59:59.999+09:00`,
    };
}

/** 직전 동일 길이 기간. overview의 전기간 대비(pct)용. */
export function previousRange(fromYmd: string, toYmd: string): { fromYmd: string; toYmd: string } {
    const fromMs = new Date(`${fromYmd}T00:00:00Z`).getTime();
    const toMs = new Date(`${toYmd}T00:00:00Z`).getTime();
    const spanMs = toMs - fromMs + DAY_MS;
    return {
        fromYmd: ymd(new Date(fromMs - spanMs)),
        toYmd: ymd(new Date(fromMs - DAY_MS)),
    };
}

/**
 * "YYYY-MM-DD" 형식이면서 실재하는 날짜인지 검증한다.
 *
 * 웹은 UI가 날짜 피커라 형식이 보장되지만 MCP는 Claude가 "지난달" 같은 문자열을
 * 넣을 수 있다. 검증 없이 넘기면 Postgres가 예외를 던져 -32603 내부 오류가 된다.
 * 정규식만으로는 2026-02-30이 통과하므로 실제 파싱 결과까지 대조한다.
 */
export function isValidYmd(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    return ymd(parsed) === value;
}
