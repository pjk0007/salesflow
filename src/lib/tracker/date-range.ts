/**
 * 조회 기간 처리 — 업무 날짜(KST) 경계의 공통 지점.
 *
 * 웹 route 4곳(funnel·overview·engagement·ad-performance)에 같은 구현이 중복돼 있었다.
 * MCP 툴이 웹과 같은 수치를 내려면 규약이 한 글자도 달라선 안 되므로 여기로 모은다.
 * 발송 이력·알림톡·레코드 등 날짜 문자열(YYYY-MM-DD)을 받는 다른 API도 이 경계를 쓴다.
 */

import { addDaysYmd, kstParts } from "../kst";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 기본 조회 기간(일). 오늘(KST)을 포함해 30일이다. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * from/to(YYYY-MM-DD, 둘 다 optional)를 정규화한다.
 *
 * 생략한 쪽은 KST 오늘 기준이다 — 서버가 UTC여도 한국 오전 9시 전에 "어제"가 되지 않는다.
 * from 기본값은 오늘을 포함한 30일(오늘 - 29일)이다.
 *
 * now를 인자로 받는 것은 테스트를 위해서다 — Date.now()에 의존하면 기본값 계약을
 * 고정할 수 없다.
 */
export function resolveRange(
    from: string | null | undefined,
    to: string | null | undefined,
    now: Date = new Date()
): { fromYmd: string; toYmd: string } {
    const today = kstParts(now).date;
    const toYmd = to && to.length > 0 ? to : today;
    const fromYmd = from && from.length > 0 ? from : addDaysYmd(today, 1 - DEFAULT_RANGE_DAYS);
    return { fromYmd, toYmd };
}

/** KST 날짜의 시작(00:00:00.000) ISO. 시작일만 있는 필터의 하한(>=)으로 쓴다. */
export function kstDayStartIso(ymd: string): string {
    return `${ymd}T00:00:00+09:00`;
}

/** KST 날짜의 끝(23:59:59.999) ISO. 종료일만 있는 필터의 포함 상한(<=)으로 쓴다. */
export function kstDayEndIso(ymd: string): string {
    return `${ymd}T23:59:59.999+09:00`;
}

/** KST 자정 기준 ISO 경계(양 끝 포함: >= fromIso AND <= toIso). */
export function rangeBounds(fromYmd: string, toYmd: string): { fromIso: string; toIso: string } {
    return { fromIso: kstDayStartIso(fromYmd), toIso: kstDayEndIso(toYmd) };
}

export const INVALID_YMD_ERROR = "날짜는 YYYY-MM-DD 형식으로 입력해주세요.";

export type KstDateFilter =
    | { ok: true; fromIso: string | null; toIso: string | null }
    | { ok: false; error: string };

/**
 * 목록 API의 시작일·종료일 쿼리(YYYY-MM-DD, 각각 선택) → KST 하루 경계(양 끝 포함).
 * 빈 값은 미지정이다. 형식이 틀리면 한국어 오류를 돌려 route가 400으로 응답한다
 * (그대로 DB에 넘기면 서버 시간대로 해석되거나 500이 된다).
 */
export function kstDateFilter(
    startDate: string | null | undefined,
    endDate: string | null | undefined
): KstDateFilter {
    const start = startDate || null;
    const end = endDate || null;
    if ((start && !isValidYmd(start)) || (end && !isValidYmd(end))) {
        return { ok: false, error: INVALID_YMD_ERROR };
    }
    return {
        ok: true,
        fromIso: start ? kstDayStartIso(start) : null,
        toIso: end ? kstDayEndIso(end) : null,
    };
}

/** 직전 동일 길이 기간. overview의 전기간 대비(pct)용. */
export function previousRange(fromYmd: string, toYmd: string): { fromYmd: string; toYmd: string } {
    const spanDays = (Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS + 1;
    return {
        fromYmd: addDaysYmd(fromYmd, -spanDays),
        toYmd: addDaysYmd(fromYmd, -1),
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
    return parsed.toISOString().slice(0, 10) === value;
}
