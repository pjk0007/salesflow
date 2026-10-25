/**
 * 상담 설정 변경 이력의 객체 값(messengerSettings·operations)을 바뀐 하위 항목만 한국어로 펼친다.
 * 저장 형식은 바꾸지 않으므로 기존 이력도 같은 방식으로 보인다.
 */
const subFields: Record<string, string> = {
    enabled: "사용",
    tagline: "소개 문구",
    consultationUrl: "도입 상담 링크",
    emailNotifications: "이메일 알림",
    calendar: "업무시간",
    showHours: "업무시간 표시",
    awayMessage: "부재 안내",
    includeAi: "AI 응대 포함",
    pauseOnSnooze: "보류 중 응답 시간 제외",
    firstMinutes: "첫 응답 목표(분)",
    nextMinutes: "다음 응답 목표(분)",
    resolutionMinutes: "해결 목표(분)",
};
/** 펼칠 때 건너뛰는 내부 값 */
const hidden = new Set(["version"]);
const isPlain = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function flatten(value: unknown): Record<string, unknown> {
    if (!isPlain(value)) return {};
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (hidden.has(key)) continue;
        // 운영 설정은 { version, policy: {...} } 모양이라 policy 한 단계를 펼친다.
        if (key === "policy" && isPlain(item)) Object.assign(out, flatten(item));
        else out[key] = item;
    }
    return out;
}
export type AuditSubChange = { field: string; before: unknown; after: unknown };
/** 객체 값이면 바뀐 하위 항목 목록, 아니면 null(기존 한 줄 표시를 쓴다). */
export function objectChanges(before: unknown, after: unknown): AuditSubChange[] | null {
    if (!isPlain(before) && !isPlain(after)) return null;
    const a = flatten(before),
        b = flatten(after);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((key) => !same(a[key], b[key]))
        .map((key) => ({ field: subFields[key] ?? key, before: a[key] ?? null, after: b[key] ?? null }));
}
