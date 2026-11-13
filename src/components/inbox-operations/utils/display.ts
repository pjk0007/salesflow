export const operationsLabels: Record<string, string> = {
    customer: "새 고객 문의",
    assigned: "상담 담당 배정",
    handoff: "상담원 확인 요청",
    identity: "회원 상담 이력 연결",
    mentioned: "내부 메모 멘션",
    sla_first: "첫 답변 목표 초과",
    sla_next: "추가 답변 목표 초과",
    sla_resolution: "해결 목표 초과",
};
export const durationText = (ms: number | null) => {
    if (ms === null) return "—";
    if (ms < 60000) return `${Math.round(ms / 1000)}초`;
    const minutes = Math.round(ms / 60000);
    return `${Math.floor(minutes / 60) ? Math.floor(minutes / 60) + "시간 " : ""}${minutes % 60}분`;
};
export const operationTime = (value: string) =>
    new Date(value).toLocaleString("ko-KR");
export function dayString(at: Date, zone = "Asia/Seoul") {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        })
            .formatToParts(at)
            .map((p) => [p.type, p.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
}
/** 큰 숫자용 시간 조각 — "3분 8초", "20시간 2분", "2일 4시간" */
export function durationParts(ms: number): Array<{ value: number; unit: string }> {
    const s = Math.round(ms / 1000);
    if (s < 60) return [{ value: s, unit: "초" }];
    if (s < 3600) return [{ value: Math.floor(s / 60), unit: "분" }, { value: s % 60, unit: "초" }].filter((p, i) => i === 0 || p.value);
    const m = Math.round(s / 60);
    if (m < 1440) return [{ value: Math.floor(m / 60), unit: "시간" }, { value: m % 60, unit: "분" }].filter((p, i) => i === 0 || p.value);
    const h = Math.round(m / 60);
    return [{ value: Math.floor(h / 24), unit: "일" }, { value: h % 24, unit: "시간" }].filter((p, i) => i === 0 || p.value);
}
export const durationShort = (ms: number | null) =>
    ms === null ? "—" : durationParts(ms).map((p) => `${p.value}${p.unit}`).join(" ");
