/**
 * 폼 페이지 URL에서 유입 출처 파라미터를 수집한다.
 *
 * 임베드 스니펫이 부모 페이지의 location.search를 통째로 넘기므로
 * 화이트리스트 방식으로 필요한 키만 골라낸다.
 */

export type AttributionParams = {
    clickId?: string;
    utmCampaign?: string;
    utmSource?: string;
    utmMedium?: string;
};

const MAX_LEN = 200; // DB 컬럼이 varchar(200)
const CLICK_ID_PREFIX = "clk_"; // /api/track/click이 발급하는 토큰 형식

function take(sp: URLSearchParams, key: string): string | undefined {
    const raw = sp.get(key);
    if (!raw) return undefined;
    return raw.slice(0, MAX_LEN);
}

export function parseAttributionParams(search: string): AttributionParams {
    // 실측 데이터에 "...outreach?utm_source=owned" 처럼 ?가 중복된 URL이 있다.
    // URLSearchParams는 첫 ?만 구분자로 보므로 나머지를 &로 바꿔 뒤쪽 값도 잡는다.
    const normalized = search.replace(/^\?/, "").replace(/\?/g, "&");
    const sp = new URLSearchParams(normalized);

    const result: AttributionParams = {};

    const clickId = take(sp, "sendb_cid");
    if (clickId?.startsWith(CLICK_ID_PREFIX)) {
        result.clickId = clickId;
    }

    const utmCampaign = take(sp, "utm_campaign");
    if (utmCampaign) result.utmCampaign = utmCampaign;

    const utmSource = take(sp, "utm_source");
    if (utmSource) result.utmSource = utmSource;

    const utmMedium = take(sp, "utm_medium");
    if (utmMedium) result.utmMedium = utmMedium;

    return result;
}

/**
 * 캠페인 값에서 링크 문법 잔재를 제거한다.
 *
 * AI가 본문에 마크다운 링크 [텍스트](URL)를 쓰면서 닫는 ) 나 ]가
 * utm_campaign 값에 딸려 들어간 발송이 실제로 존재한다.
 * (운영 DB 실측: "outreach)" 89건, "outreach]디자이너하이어" 등 20종)
 */
export function cleanCampaignValue(value: string): string | undefined {
    if (!value) return undefined;

    // 캠페인 이름에 쓰이는 문자(영숫자·하이픈·언더스코어)만 앞에서부터 취한다.
    const match = value.match(/^[A-Za-z0-9_-]+/);
    return match ? match[0] : undefined;
}
