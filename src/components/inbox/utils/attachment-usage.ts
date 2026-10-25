const units = ["B", "KB", "MB", "GB"];
export function formatBytes(bytes: number) {
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit ? value.toFixed(1).replace(/\.0$/, "") : value}${units[unit]}`;
}
/** 90% 이상이면 경고. 정리 기능은 보존 정책 결정 전이라 운영 관리자 조정만 안내한다. */
export function attachmentUsageText(usedBytes: number, quotaBytes: number) {
    const percent = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
    const warn = percent >= 90;
    return {
        warn,
        text: `첨부 저장 사용량 ${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)} (${percent}%)${
            warn ? " · 한도에 닿으면 고객과 직원 모두 파일을 보낼 수 없습니다. 운영 관리자에게 한도 조정을 요청해주세요." : ""
        }`,
    };
}
