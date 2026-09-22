/**
 * 플랜 slug로 월 AI 토큰 한도를 정한다.
 *
 * 분기 키가 slug인 이유: plans.name은 표시용(varchar, UNIQUE 없음)이라 문구를 바꾸면
 * 한도가 조용히 폴백값으로 떨어진다. slug는 UNIQUE라 식별자로 안전하다.
 * 반환값이 int4 상한(21.4억)을 넘으므로 ai_usage_quotas의 bigint 전환이 전제다.
 *
 * @returns 월 한도(토큰 수). 활성 구독이 없는 경우는 호출부(getQuotaLimitForOrg)가 따로 처리한다.
 */
export function getQuotaLimitForPlanSlug(planSlug: string | undefined): number {
    if (planSlug === "enterprise") return 5_000_000_000; // 50억
    if (planSlug === "pro") return 100_000_000; // 1억
    return 10_000_000; // Free 1천만
}
