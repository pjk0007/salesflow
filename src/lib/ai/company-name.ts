/**
 * 회사명을 캐시 키로 정규화한다.
 * 공백·법인 표기(㈜·(주)·주식회사·(유)·유한회사)·대소문자 차이만 다른 이름을 같은 회사로 묶는다.
 *
 * ⚠ drizzle/0068_company_research_cache_idx.sql의 regexp_replace와 규칙이 일치해야 한다 —
 * 어긋나면 조회가 인덱스를 타지 못해 records 풀스캔(약 17초)이 된다.
 */
export function normalizeCompanyName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "")
        .replace(/\s+/g, "")
        .trim();
}
