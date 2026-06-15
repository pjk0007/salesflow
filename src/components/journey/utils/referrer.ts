// 유입 경로 분류 — referrer + landingPage(utm)를 사람이 읽는 채널 라벨로.
// 동일 정책이 SQL(트래커 overview route)에도 적용됨 — 두 곳 일치 유지 필수.

// 채널 라벨은 동적(소셜은 utm_source명을 그대로) — 고정 enum 아닌 string.
export type InflowChannel = string;

/**
 * SegmentFilter 드롭다운의 상위 라벨 ↔ classifyInflow 출력 라벨 매핑.
 * "네이버" 선택 시 "네이버 검색" + "네이버 검색광고" 둘 다 매칭 / "구글" 동일.
 *
 * 사용 예: groupChannel("네이버 검색광고") === "네이버"
 */
const SINGLETON_GROUPS = new Set<string>(["직접", "메일", "메타 광고"]);
export function groupChannel(detail: InflowChannel): string {
    if (detail === "네이버 검색" || detail === "네이버 검색광고") return "네이버";
    if (detail === "구글 검색" || detail === "구글 검색광고") return "구글";
    if (SINGLETON_GROUPS.has(detail)) return detail;
    return "기타";
}

/** 광고/자연 구분 — 광고 라벨이면 paid, 아니면 organic. */
const PAID_DETAILS = new Set<string>(["네이버 검색광고", "구글 검색광고", "메타 광고"]);
export function isPaidChannel(detail: InflowChannel): boolean {
    return PAID_DETAILS.has(detail);
}

/**
 * 채널 라벨 → 브랜드 컬러 Badge 클래스.
 * groupChannel로 상위 그룹화한 뒤 매핑하므로 "구글 검색"/"구글 검색광고" 동일 색.
 * Tailwind JIT가 스캔하도록 클래스는 완전한 리터럴로 둔다(동적 조합 금지).
 */
const CHANNEL_BADGE_CLASS: Record<string, string> = {
    네이버: "bg-[#03C75A]/10 text-[#03C75A] border-[#03C75A]/20",
    구글: "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20",
    "메타 광고": "bg-[#0082FB]/10 text-[#0082FB] border-[#0082FB]/20",
    메일: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};
export function channelBadgeClass(detail: InflowChannel): string {
    return CHANNEL_BADGE_CLASS[groupChannel(detail)] ?? "";
}

/**
 * SegmentFilter(드롭다운 + 광고/자연 토글) 조건에 맞는지 판정.
 * - group: "전체" 의미면 null 전달. 그 외엔 groupChannel 결과 그대로.
 * - mode:  "all" | "paid" | "organic"
 */
export function matchesChannelFilter(
    detail: InflowChannel,
    group: string | null,
    mode: "all" | "paid" | "organic",
): boolean {
    if (group !== null && groupChannel(detail) !== group) return false;
    if (mode === "paid" && !isPaidChannel(detail)) return false;
    if (mode === "organic" && isPaidChannel(detail)) return false;
    return true;
}

interface ParsedUtm {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    gclid: boolean;
    fbclid: boolean;
    sendbClickId: boolean;
}

export function parseUtm(landingPage: string | null): ParsedUtm {
    const empty: ParsedUtm = { source: null, medium: null, campaign: null, gclid: false, fbclid: false, sendbClickId: false };
    if (!landingPage) return empty;
    try {
        const url = new URL(landingPage);
        const q = url.searchParams;
        return {
            source: q.get("utm_source")?.toLowerCase() ?? null,
            medium: q.get("utm_medium")?.toLowerCase() ?? null,
            campaign: q.get("utm_campaign") ?? null,
            gclid: q.has("gclid"),
            fbclid: q.has("fbclid"),
            sendbClickId: q.has("sendb_cid"),
        };
    } catch {
        return empty;
    }
}

// utm_source 같은 단어를 채널 라벨로 표시할 때 첫글자 대문자화.
function titleCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// 자체 도메인 referrer = 직접(사이트 내부 클릭/재방문) 판별.
// 디하/백오피스랩/픽셀앤로직 + 로컬 dev. 추후 사이트 설정으로 도메인 받게 일반화 가능.
function isOwnDomain(ref: string): boolean {
    return /designer-hire\.com|backofficelab\.com|pixelandlogic\.com|localhost/i.test(ref);
}

/**
 * 유입 채널 분류.
 * 우선순위: 광고(fbclid/gclid/medium=paid) → 메일 → 소셜(medium=social, source 그대로) →
 *           검색엔진 referrer → 자체 도메인=직접 → referrer 없음=직접 → 기타.
 */
export function classifyInflow(referrer: string | null, landingPage: string | null): InflowChannel {
    const ref = (referrer ?? "").toLowerCase();
    const utm = parseUtm(landingPage);

    // 메일 (sendb 우리 클릭 ID > utm)
    if (utm.sendbClickId || utm.source === "email" || ref === "email" || utm.medium === "email" || utm.medium === "sales") {
        return "메일";
    }

    // 광고
    if (utm.fbclid || (["meta", "facebook", "instagram"].includes(utm.source ?? "") && ["cpc", "paid", "paid_social"].includes(utm.medium ?? ""))) {
        return "메타 광고";
    }
    if (utm.gclid || (utm.source === "google" && ["cpc", "paid", "pmax"].includes(utm.medium ?? ""))) {
        return "구글 검색광고";
    }
    if (utm.source === "naver" && ["cpc", "paid"].includes(utm.medium ?? "")) {
        return "네이버 검색광고";
    }

    // 소셜 (organic) — medium=social이면 source 그대로 라벨
    if (["social", "social-organic", "organic_social"].includes(utm.medium ?? "") && utm.source) {
        return titleCase(utm.source);
    }

    // 검색엔진 (utm 없거나 source만 있는 경우)
    if (/search\.naver\.com/.test(ref) || utm.source === "naver") return "네이버 검색";
    if (/google\.com/.test(ref) || utm.source === "google") return "구글 검색";
    if (/bing\.com|duckduckgo|daum\.net/.test(ref)) return "검색";

    // 소셜 (referrer 기반, utm 없을 때)
    if (/threads\.com/.test(ref)) return "Threads";
    if (/instagram\.com/.test(ref)) return "Instagram";
    if (/facebook\.com|fb\.com/.test(ref)) return "Facebook";
    if (/twitter\.com|x\.com|t\.co/.test(ref)) return "X";

    // 자체 도메인 또는 referrer 없음 = 직접
    if (!ref || isOwnDomain(ref)) return "직접";

    return "기타";
}
