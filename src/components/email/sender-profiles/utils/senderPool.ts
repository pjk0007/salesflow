/**
 * AI 규칙의 발신 주소 묶음을 화면에서 다루는 도우미. 순수 함수만 — 시험이 이 파일만 불러도 되게 한다.
 */

/**
 * 묶음을 지금 조직에 있는 프로필(knownIds)과 지워진 프로필로 나눈다. 순서는 그대로 둔다.
 *
 * 프로필을 지워도 규칙의 묶음에는 id가 남는다. 그대로 저장·복제하면 서버가 "선택한 발신 주소를 찾을 수 없습니다"로
 * 거절하므로, 복제할 때는 남은 id만 보낸다. 다 지워졌으면 빈 묶음 = 기본 발신 프로필이다.
 */
export function splitKnownSenderIds(
    pool: readonly number[],
    knownIds: Iterable<number>
): { kept: number[]; dropped: number[] } {
    const known = new Set(knownIds);
    const kept: number[] = [];
    const dropped: number[] = [];
    for (const id of pool) {
        (known.has(id) ? kept : dropped).push(id);
    }
    return { kept, dropped };
}
