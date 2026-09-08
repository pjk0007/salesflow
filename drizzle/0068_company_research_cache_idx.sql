-- 회사조사 결과를 org 단위로 재사용하기 위한 조회 인덱스.
-- 이 인덱스가 없으면 캐시 미스마다 records 전체(28만행)를 훑어 17초가 걸린다 —
-- 웹서치(약 20초)보다 느려 캐시가 오히려 손해가 된다.
-- 인덱스 표현식은 src/lib/ai/company-research-cache.ts의 normalizeCompanyName과 반드시 일치해야 한다.
CREATE INDEX IF NOT EXISTS "records_company_research_key_idx"
ON "records" (
    "org_id",
    (regexp_replace(
        lower(("data" -> '_companyResearch' ->> 'companyName')),
        '\(주\)|㈜|주식회사|\(유\)|유한회사|\s+',
        '',
        'g'
    ))
)
WHERE "data" ? '_companyResearch';
