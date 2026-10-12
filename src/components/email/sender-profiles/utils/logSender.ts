/**
 * 발송 이력 한 줄의 "보낸 주소" — 실제 서버에서 메일이 어느 주소로 나갔는지 확인하는 칸. 순수 함수만.
 *
 * 서버(GET /api/email/logs)는 줄마다 두 가지를 준다.
 * - senderEmail: 보낼 때 실제로 쓴 주소 (email_send_logs.sender_email, 마이그레이션 0073부터 저장). 프로필 주소를 나중에 바꿔도 그대로다
 * - senderProfile {id, name, fromEmail}: sender_profile_id로 붙인 발신 프로필의 **지금** 값. 프로필을 지웠으면 null
 * 화면은 senderEmail을 먼저 쓰고, 없으면(0073 전 옛 이력) 프로필의 지금 주소를 "(현재 프로필)" 표시와 함께 쓴다 —
 * 그 사이 프로필 주소를 바꿨으면 실제로 나간 주소와 다를 수 있다는 뜻이다 (DESIGN-3 4-1, R7).
 * 둘 다 없으면(발신 프로필이 생기기 전 이력·설정 발신자·지운 프로필) "—"를 보인다.
 * 프로필을 지운 경우는 sender_profile_id가 남으므로(이력 칸에는 외래키가 없다) 설명에 번호를 적는다.
 */
import type { LogSenderProfile } from "../types";

export interface LogSenderSource {
    senderEmail?: string | null;
    senderProfile?: LogSenderProfile | null;
    senderProfileId?: number | null;
}

/** 표 한 칸에 보일 주소와, 그 주소가 보낼 때 값이 아니라 프로필의 지금 값인지 */
export interface LogSenderParts {
    /** 보인 주소. 없으면 null ("—") */
    email: string | null;
    /** true = 보낼 때 주소가 기록되지 않아 프로필의 지금 주소를 보인다 ("(현재 프로필)") */
    fromCurrentProfile: boolean;
}

export const CURRENT_PROFILE_MARK = "(현재 프로필)";

function storedEmail(log: LogSenderSource): string | null {
    const v = log.senderEmail?.trim();
    return v ? v : null;
}

export function logSenderParts(log: LogSenderSource): LogSenderParts {
    const stored = storedEmail(log);
    if (stored) return { email: stored, fromCurrentProfile: false };
    const current = log.senderProfile?.fromEmail || null;
    return { email: current, fromCurrentProfile: current !== null };
}

/** 표 한 칸의 글. 예: "sales1@example.com", 옛 이력이면 "sales1@example.com (현재 프로필)", 없으면 "—" */
export function logSenderText(log: LogSenderSource): string {
    const { email, fromCurrentProfile } = logSenderParts(log);
    if (!email) return "—";
    return fromCurrentProfile ? `${email} ${CURRENT_PROFILE_MARK}` : email;
}

/**
 * 마우스를 올리거나 상세 보기에서 보이는 글.
 * 예: "영업팀 <sales@example.com>",
 *     보낸 뒤 프로필 주소를 바꿨으면 "영업팀 <old@example.com> — 지금 프로필 주소는 new@example.com",
 *     옛 이력이면 "영업팀 <sales@example.com> (현재 프로필 — 보낼 때 주소는 기록되지 않았습니다)",
 *     지운 프로필이면 "old@example.com (지운 발신 프로필 #7)" 또는 "— (지운 발신 프로필 #7)"
 */
export function logSenderDetail(log: LogSenderSource): string {
    const stored = storedEmail(log);
    const p = log.senderProfile;
    const id = log.senderProfileId ?? null;
    const deleted = !p?.fromEmail && id !== null ? ` (지운 발신 프로필 #${id})` : "";

    if (stored) {
        if (!p?.fromEmail) return `${stored}${deleted}`;
        const named = p.name ? `${p.name} <${stored}>` : stored;
        return p.fromEmail.toLowerCase() === stored.toLowerCase() ? named : `${named} — 지금 프로필 주소는 ${p.fromEmail}`;
    }
    if (p?.fromEmail) {
        const named = p.name ? `${p.name} <${p.fromEmail}>` : p.fromEmail;
        return `${named} (현재 프로필 — 보낼 때 주소는 기록되지 않았습니다)`;
    }
    return `—${deleted}`;
}
