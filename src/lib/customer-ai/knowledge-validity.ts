/** 상담 근거의 90일 유효기간은 서버 선택과 화면 안내에서 같은 경계를 쓴다. */
export function isUsableSupportClaim(claim: { purposes: string[]; checkedAt: string }, now = Date.now()) {
    const checkedAt = Date.parse(claim.checkedAt);
    return claim.purposes.includes("customer_chat") && Number.isFinite(checkedAt) &&
        checkedAt <= now && now - checkedAt <= 90 * 86400000;
}
