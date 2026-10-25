/**
 * 실험을 연 메일 화면 주소 — tab=experiments&experimentId=N.
 * 현재 주소의 다른 값(예: ruleId)은 남기고 실험 번호만 바꾼다. 새로고침·뒤로 가기에도 같은 실험이 열린다 (UX-242).
 */
export function experimentHref(id: number, current: string | URLSearchParams = ""): string {
    const params = new URLSearchParams(current);
    params.set("tab", "experiments");
    params.set("experimentId", String(id));
    return `/email?${params.toString()}`;
}
