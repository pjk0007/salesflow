// 세션 유입 상세 파싱 — referrer + landingPage(쿼리스트링)에서
// 채널 라벨 / 검색어 / 광고 키워드 / 광고 소재 등을 사람이 읽는 형태로 추출.
// 트래커 방문자 상세에서 "어떻게 들어왔는지"를 자세히 보여주기 위함.

export interface InflowDetail {
    channel: string;              // 예: "네이버 검색광고", "구글 검색", "직접"
    isPaid: boolean;              // 광고 유입 여부
    searchQuery: string | null;   // 실제 사용자가 검색한 검색어 (n_query / q 등)
    adKeyword: string | null;     // 광고 입찰 키워드 (utm_term)
    adContent: string | null;     // 광고 소재/그룹 (utm_content)
    referrerHost: string | null;  // 유입 출처 호스트
}

function getParams(landingPage: string | null): URLSearchParams | null {
    if (!landingPage) return null;
    try {
        return new URL(landingPage).searchParams;
    } catch {
        return null;
    }
}

function host(url: string | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\.|^m\./, "");
    } catch {
        return null;
    }
}

function decode(v: string | null): string | null {
    if (!v) return null;
    try {
        return decodeURIComponent(v).trim() || null;
    } catch {
        return v.trim() || null;
    }
}

/**
 * 검색엔진 referrer/landingPage에서 실제 검색어 추출.
 * 네이버 광고는 n_query(실제 검색어)가 landingPage에 실린다.
 * 자연 검색은 referrer의 query/q 파라미터에 실리기도 한다(엔진이 넘겨줄 때).
 */
function extractSearchQuery(params: URLSearchParams | null, referrer: string | null): string | null {
    if (params) {
        const fromLanding =
            params.get("n_query") ?? params.get("query") ?? params.get("q") ?? params.get("keyword");
        if (fromLanding) return decode(fromLanding);
    }
    if (referrer) {
        try {
            const rq = new URL(referrer).searchParams;
            const fromRef = rq.get("query") ?? rq.get("q") ?? rq.get("n_query");
            if (fromRef) return decode(fromRef);
        } catch {
            /* ignore */
        }
    }
    return null;
}

/**
 * 유입 채널 라벨 + 광고/자연 구분. classifyInflow와 정책 일치시키되 광고 세분화.
 */
function classifyChannel(source: string | null, medium: string | null, ref: string, hasGclid: boolean, hasFbclid: boolean): { channel: string; isPaid: boolean } {
    const paidMedium = medium === "cpc" || medium === "paid" || medium === "pmax" || medium === "ppc";

    if (source === "email" || medium === "email" || ref === "email") return { channel: "메일", isPaid: false };
    if (hasFbclid || source === "meta" || source === "facebook" || source === "instagram" || /facebook|instagram|fb\.com/.test(ref)) {
        return { channel: "메타 광고", isPaid: true };
    }
    if (hasGclid || (source === "google" && paidMedium) || (/google/.test(ref) && paidMedium)) {
        return { channel: "구글 검색광고", isPaid: true };
    }
    if (source === "naver" && paidMedium) return { channel: "네이버 검색광고", isPaid: true };
    if (/google/.test(ref) || source === "google") return { channel: "구글 검색", isPaid: false };
    if (/naver/.test(ref) || source === "naver") return { channel: "네이버 검색", isPaid: false };
    if (/daum|kakao/.test(ref) || source === "daum" || source === "kakao") return { channel: "다음/카카오", isPaid: paidMedium };
    if (!ref) return { channel: "직접", isPaid: false };
    return { channel: "기타", isPaid: paidMedium };
}

export function parseInflowDetail(referrer: string | null, landingPage: string | null): InflowDetail {
    const params = getParams(landingPage);
    const ref = (referrer ?? "").toLowerCase();
    const source = params?.get("utm_source")?.toLowerCase() ?? null;
    const medium = params?.get("utm_medium")?.toLowerCase() ?? null;
    const { channel, isPaid } = classifyChannel(
        source,
        medium,
        ref,
        params?.has("gclid") ?? false,
        params?.has("fbclid") ?? false,
    );

    return {
        channel,
        isPaid,
        searchQuery: extractSearchQuery(params, referrer),
        adKeyword: decode(params?.get("utm_term") ?? null),
        adContent: decode(params?.get("utm_content") ?? null),
        referrerHost: host(referrer),
    };
}
