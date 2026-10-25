import { pickSenderCandidates } from "../email-sender-limit-paths";
import { capSchedule, DEFAULT_LIMIT_SETTINGS, toLimitSettings } from "../email-sender-limit-rules";
import { addDaysYmd } from "../kst";

/** email_sender_profiles 원시 행 (snake_case 칸) */
export type SenderProfileRow = Record<string, unknown>;

/**
 * 실험 미리보기의 일별 발신 용량. 실제 발송(claimSender pool 모드)과 같은 규칙으로 쓸 주소를 고른다 (UX-159):
 * 규칙 묶음 중 남은 주소 → 없으면 기본 프로필 → 그것도 없으면 설정 발신자(email_configs).
 * 설정 발신자는 한도 카운터가 없으므로 용량은 null(제한 없음)이다. 날짜 칸은 주소가 없어도 채운다.
 */
export function previewCapacitySchedule(
    profiles: readonly SenderProfileRow[],
    configuredIds: readonly number[] | null,
    todayYmd: string,
    days = 42,
): Array<{ date: string; capacity: number | null }> {
    const candidates = profiles.map((p) => ({
        id: Number(p.id),
        fromEmail: String(p.from_email ?? ""),
        fromName: String(p.from_name ?? ""),
        isDefault: p.is_default === true || p.is_default === 1,
        row: p,
    }));
    // 설정 발신자 자체는 용량 계산에 필요 없다 — 주소가 하나도 안 남으면 제한 없음으로 본다
    const picked = pickSenderCandidates(candidates, { mode: "pool", ids: configuredIds ?? [], config: null });
    const selected = Array.isArray(picked) ? picked : [];
    const schedules = selected.map((c) => {
        const limits = toLimitSettings(
            Object.fromEntries(
                Object.keys(DEFAULT_LIMIT_SETTINGS).map((k) => [k, c.row[k.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)]]),
            ),
        );
        return capSchedule(limits, todayYmd, days);
    });
    return Array.from({ length: days }, (_, i) => ({
        date: schedules[0]?.[i]?.date ?? addDaysYmd(todayYmd, i),
        capacity:
            schedules.length === 0 || schedules.some((s) => s[i]?.cap === null)
                ? null
                : schedules.reduce((sum, s) => sum + (s[i]?.cap ?? 0), 0),
    }));
}
