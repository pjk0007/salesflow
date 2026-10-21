/** 소수 첫째 자리 백분율. 분모가 0이면 null. */
export function openRatePercent(opened: number, base: number): number | null {
    return base === 0 ? null : Math.round(opened / base * 1000) / 10;
}
export function openRateText(rate: number | null): string {
    return rate === null ? "—" : `${rate}%`;
}
export function openRatioText(opened: number, base: number): string | undefined {
    return base === 0 ? undefined : `${opened}/${base}`;
}
export function openCountText(opened: number, base: number): string {
    return base === 0 ? "—" : String(opened);
}
export const OPEN_NOTICE_LINES: readonly string[] = [
    "오픈은 추정치입니다. 발송 60초 안의 요청과 메일 보안 검사기는 빼고 셉니다.",
    "이미지를 막고 읽으면 오픈이 잡히지 않지만, 링크를 누르면 오픈으로 셉니다.",
    "Apple 메일은 열지 않아도 이미지를 미리 받아 오픈으로 잡힐 수 있습니다.",
    "오픈 추적을 넣은 뒤 보낸 메일만 오픈율에 셉니다.",
];
export const OPEN_NOTICE_TITLE = OPEN_NOTICE_LINES.join("\n");
