import { db, records } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { normalizeCompanyName } from "./company-name";
import type { CompanyResearchResult } from "./search";

/** 조사 실패 시 search.ts가 채워 넣는 문구 — 캐시로 재사용하면 안 된다. */
const NOT_FOUND_MARK = "정보를 찾을 수 없습니다";

type CachedResearch = Omit<CompanyResearchResult, "usage">;

/**
 * 같은 org에서 이미 조사한 회사 정보를 찾아 반환한다. 없으면 null.
 *
 * 웹서치 1건이 약 19,000 input tokens + 검색요청 1.6회이므로, 대량 발송에서
 * 같은 회사가 여러 레코드에 걸쳐 있으면 그만큼 그대로 중복 과금된다.
 *
 * 조사에 실패한("정보를 찾을 수 없습니다") 결과는 재사용하지 않는다 —
 * 다음 기회에 다시 시도할 수 있어야 한다.
 *
 * @security orgId로 조회 범위를 제한한다. 호출부가 넘기는 orgId가 곧 격리 경계이므로
 *           요청에서 검증된 값만 넘길 것.
 */
export async function findCachedCompanyResearch(
    orgId: string,
    companyName: string
): Promise<CachedResearch | null> {
    const key = normalizeCompanyName(companyName);
    if (!key) return null;

    const [row] = await db
        .select({ research: sql<CachedResearch>`${records.data} -> '_companyResearch'` })
        .from(records)
        .where(
            and(
                eq(records.orgId, orgId),
                sql`${records.data} ? '_companyResearch'`,
                // 저장된 회사명도 같은 규칙으로 정규화해서 비교한다.
                sql`regexp_replace(
                        lower(${records.data} -> '_companyResearch' ->> 'companyName'),
                        '\\(주\\)|㈜|주식회사|\\(유\\)|유한회사|\\s+',
                        '',
                        'g'
                    ) = ${key}`,
                sql`coalesce(${records.data} -> '_companyResearch' ->> 'description', '') NOT LIKE ${'%' + NOT_FOUND_MARK + '%'}`
            )
        )
        .limit(1);

    return row?.research ?? null;
}
