export function assignmentHoursLabel(
    hours: {
        configured: boolean;
        open: boolean;
        timezone: string | null;
        nextOpenAt: string | null;
    } | null,
) {
    if (!hours) return "업무시간 제한 없음";
    if (!hours.configured) return "업무시간 미설정 · 팀 대기열 유지";
    if (hours.open) return `업무시간 중 · ${hours.timezone}`;
    const next = hours.nextOpenAt
        ? new Date(hours.nextOpenAt).toLocaleString("ko-KR", {
              timeZone: hours.timezone ?? undefined,
          })
        : null;
    return `업무시간 밖 · 팀 대기열 유지${next ? ` · 다음 업무 시작 ${next} (${hours.timezone})` : ""}`;
}
