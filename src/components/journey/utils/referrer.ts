// 유입 경로 분류 — referrer + landingPage(utm)를 사람이 읽는 채널 라벨로

export type InflowChannel =
    | "메타 광고"
    | "구글 검색광고"
    | "구글 검색"
    | "네이버"
    | "메일"
    | "직접"
    | "기타";

interface ParsedUtm {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    gclid: boolean;
    fbclid: boolean;
    sendbClickId: boolean; // sendb 메일 트래킹 클릭 ID 존재 = 우리 메일 클릭 100% 확실
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

function sameHost(referrer: string, landingPage: string | null): boolean {
    if (!landingPage) return false;
    try {
        return new URL(referrer).hostname === new URL(landingPage).hostname;
    } catch {
        return false;
    }
}

/**
 * 유입 채널 분류. 우선순위: 메일 → 메타광고 → 구글검색광고 → 구글자연 → 네이버 → 직접 → 기타
 */
export function classifyInflow(referrer: string | null, landingPage: string | null): InflowChannel {
    const ref = (referrer ?? "").toLowerCase();
    const utm = parseUtm(landingPage);

    // 메일 신호: sendb 클릭ID(=우리 메일 클릭 확실) > utm source/medium email계열(sales도 sendb 발송에서 씀)
    if (utm.sendbClickId || utm.source === "email" || ref === "email" || utm.medium === "email" || utm.medium === "sales") {
        return "메일";
    }
    if (utm.fbclid || utm.source === "meta" || utm.source === "facebook" || utm.source === "instagram" || /facebook|instagram|fb\.com/.test(ref)) {
        return "메타 광고";
    }
    if (utm.gclid || (/google/.test(ref) && (utm.medium === "cpc" || utm.medium === "paid")) || (utm.source === "google" && (utm.medium === "cpc" || utm.medium === "paid"))) {
        return "구글 검색광고";
    }
    if (/google/.test(ref) || utm.source === "google") return "구글 검색";
    if (/naver/.test(ref) || utm.source === "naver") return "네이버";
    if (!ref || sameHost(ref, landingPage)) return "직접";
    return "기타";
}
