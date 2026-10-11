/**
 * 발신 건강 화면 글 (DESIGN-SND 10절). 쉬운 한국어로 — "SST" 같은 코드는 툴팁에만. 받는 사람 주소는 보이지 않는다.
 * DB·React를 모른다 (순수 시험).
 */
import type { HealthEventRow, PartitionHealthRow, PartitionHoldRow, SendHealthSync, SenderHealthRow } from "../types";

export const STATE_LABELS: Record<string, string> = {
    ok: "정상",
    caution: "주의",
    danger: "위험",
    insufficient: "판정 보류",
};

export function stateLabel(state: string | null | undefined, recovered = false): string {
    if (recovered && state === "ok") return "회복";
    return STATE_LABELS[String(state ?? "")] ?? "판정 전";
}

/** 배지 색 (Tailwind 클래스) */
export function stateTone(state: string | null | undefined, recovered = false): string {
    if (recovered && state === "ok") return "border-emerald-300 bg-emerald-50 text-emerald-800";
    switch (state) {
        case "danger":
            return "border-red-300 bg-red-50 text-red-800";
        case "caution":
            return "border-amber-300 bg-amber-50 text-amber-800";
        case "ok":
            return "border-slate-200 bg-slate-50 text-slate-700";
        default:
            return "border-dashed border-slate-300 text-muted-foreground";
    }
}

export function formatRateBp(bp: number | null | undefined): string {
    if (bp === null || bp === undefined || !Number.isFinite(bp)) return "-";
    return `${(bp / 100).toFixed(1)}%`;
}

const KST = 9 * 60 * 60 * 1000;

/** "10/11 14:20" (KST) */
export function formatKst(iso: string | null | undefined): string {
    if (!iso) return "-";
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "-";
    const s = new Date(d.getTime() + KST);
    return `${s.getUTCMonth() + 1}/${s.getUTCDate()} ${String(s.getUTCHours()).padStart(2, "0")}:${String(s.getUTCMinutes()).padStart(2, "0")}`;
}

/** 상태 배지 툴팁 — 확정·실패·비율·기준·창 시작 */
export function healthTooltip(x: {
    final: number;
    failed: number;
    rateBp: number | null;
    evalWindow?: string | null;
    unknown?: number;
    dsnOnly?: number;
    windowStart?: string | null;
}): string {
    const win = x.evalWindow === "30d" ? "최근 30일(느린 명단)" : "최근 7일";
    const parts = [
        `${win} 확정 ${x.final.toLocaleString("ko-KR")}통 중 실패 ${x.failed.toLocaleString("ko-KR")}통 (${formatRateBp(x.rateBp)})`,
        "기준: 200통 이상에서 5% 이상 위험 · 3% 이상 주의",
    ];
    if (x.unknown) parts.push(`NHN 결과 아직 없음 ${x.unknown}통`);
    if (x.dsnOnly) parts.push(`반송 안내(실패율에 아직 안 넣음) ${x.dsnOnly}통`);
    if (x.windowStart) parts.push(`셈 시작 ${formatKst(x.windowStart)}`);
    return parts.join("\n");
}

const NOTE_LABELS: Record<string, string> = {
    mode: "알림만·기록만 모드라 조치하지 않음",
    opt_out: "알림만 하도록 정한 대상",
    cap: "오늘 자동 멈춤 상한에 걸림",
    cap_auth: "오늘 도메인 멈춤 상한에 걸림",
    no_profile: "멈출 수 있는 발신 주소 설정 없음",
    already: "이미 멈춘 주소",
    default_sender: "조직 기본 주소라 자동으로 멈추지 않음",
    sync_stale: "NHN 결과 확인이 멈춰 자동 조치를 미룸",
    sync_initial: "NHN 결과를 처음 채우는 중이라 자동 조치를 미룸",
    unconfirmed_high: "NHN 결과가 아직 안 온 메일이 많아 자동 조치를 미룸",
};

export function actionNoteLabel(note: string | null | undefined): string | null {
    if (!note) return null;
    return NOTE_LABELS[note] ?? note;
}

const KIND_LABELS: Record<string, string> = {
    danger: "위험",
    danger_with: "위험 — 주소(명단과 함께)",
    auth_burst: "발신 인증 실패 폭주",
    release: "풀림",
    report: "매일 보고",
    cap: "상한 걸림",
    sync: "NHN 결과 확인",
};

const ACTION_LABELS: Record<string, string> = {
    hold: "명단 보류",
    pause: "주소 멈춤",
    release: "풀기",
    none: "",
};

export function eventLabel(e: Pick<HealthEventRow, "kind" | "action" | "entityType" | "mode">): string {
    const kind = KIND_LABELS[e.kind] ?? e.kind;
    const target = e.entityType === "partition" ? "명단" : e.entityType === "sender" ? "주소" : e.entityType === "domain" ? "도메인" : "";
    const action = ACTION_LABELS[e.action] ?? "";
    const mode = e.mode === "dry_run" ? " (기록만)" : "";
    return [kind, target && e.kind !== "danger_with" ? target : "", action ? `→ ${action}` : ""].filter(Boolean).join(" ") + mode;
}

const MODE_LABELS: Record<string, string> = {
    off: "꺼짐",
    dry_run: "기록만 (챗 알림·자동 조치 없음)",
    alert: "알림만 (자동 조치 없음)",
    enforce: "멈춤 + 알림",
};

export function modeLabel(mode: string): string {
    return MODE_LABELS[mode] ?? mode;
}

/** 동기화 한 줄 + 관문에 걸렸으면 "자동 조치 미룸 — 사유" */
export function syncLine(sync: SendHealthSync | null): { text: string; warning: string | null } {
    if (!sync) return { text: "NHN 결과 확인: 아직 한 번도 돌지 않았습니다", warning: "자동 조치 미룸 — NHN 결과를 아직 받지 못함" };
    const skipped = sync.skippedWindowsTotal ?? 0;
    const text =
        `NHN 결과 확인: 마지막 성공 ${formatKst(sync.lastOkAt)} · 커서 ${formatKst(sync.cursor)} · 미확정(2시간 지남) ${sync.unconfirmedOld}통` +
        (skipped > 0 ? ` · NHN이 거절해 건너뛴 기간 ${skipped}개 (마지막 ${formatKst(sync.skippedWindowsLastAt ?? null)})` : "");
    let warning: string | null = null;
    if (sync.lastErrorCode === "auth") warning = "자동 조치 미룸 — NHN 키 확인 필요";
    else if (sync.gate === "sync_stale") warning = "자동 조치 미룸 — NHN 결과 확인이 30분 넘게 멈춤";
    else if (sync.gate === "sync_initial") warning = "자동 조치 미룸 — NHN 결과를 처음 채우는 중";
    return { text, warning };
}

/** 맨 위 띠 글. 보류·멈춤이 없으면 null */
export function bannerText(holds: readonly PartitionHoldRow[], senders: readonly SenderHealthRow[]): string | null {
    const autoPaused = senders.filter((s) => s.isPaused && s.pausedSource === "auto").length;
    if (holds.length === 0 && autoPaused === 0) return null;
    const parts: string[] = [];
    if (holds.length > 0) parts.push(`명단 ${holds.length}개 보류`);
    if (autoPaused > 0) parts.push(`주소 ${autoPaused}개 자동 멈춤`);
    return `${parts.join(" · ")} — 발송 실패가 많아 대량 발송을 잠시 멈췄습니다 (폼·광고 문의 메일은 그대로 나갑니다)`;
}

/** 명단 보류 배지 글 */
export function holdLine(h: Pick<PartitionHoldRow, "reasonText" | "heldAt">): string {
    return `${h.reasonText} · ${formatKst(h.heldAt)}부터`;
}

/** 풀기 대화상자 안내 */
export function releaseNotice(
    t: { kind: "hold"; queued: number } | { kind: "sender"; preview: SenderHealthRow["releasePreview"] }
): string {
    if (t.kind === "hold") {
        return `풀면 남겨 둔 대기 ${t.queued.toLocaleString("ko-KR")}통이 원래 순서대로, 주소 한도 안에서 다시 나갑니다. 풀린 뒤 발송만으로 다시 판정합니다. 실패 주소는 명단에서 정리한 뒤 푸세요.`;
    }
    const p = t.preview;
    const cap = !p ? null : p.todayCap === null ? "제한 없음" : `${p.todayCap.toLocaleString("ko-KR")}통`;
    const warm = p?.warmupDay ? ` (웜업 ${p.warmupDay}일째)` : "";
    return `풀면 이 주소로 다시 보냅니다.${cap ? ` 풀린 뒤 오늘 한도 ${cap}${warm}.` : ""} 풀린 뒤 발송만으로 다시 판정합니다.`;
}

/** 이 규칙 묶음 중 자동 멈춘 주소 수 */
export function autoPausedInPool(pool: readonly number[], senders: readonly SenderHealthRow[]): number {
    const set = new Set(pool);
    return senders.filter((s) => set.has(s.profileId) && s.isPaused && s.pausedSource === "auto").length;
}

/** 명단 표 정렬: 위험 → 주의 → 판정 보류 → 정상 */
export function sortPartitions(rows: readonly PartitionHealthRow[]): PartitionHealthRow[] {
    const rank: Record<string, number> = { danger: 0, caution: 1, insufficient: 3, ok: 2 };
    return [...rows].sort((a, b) => (rank[a.state] ?? 4) - (rank[b.state] ?? 4) || (b.rateBp ?? -1) - (a.rateBp ?? -1) || a.name.localeCompare(b.name));
}
