/**
 * 회신 화면 글자 (DESIGN-RPL 11절). 순수 함수 — 화면·시험이 같은 글자를 쓴다.
 */
import type { ReplyItem, ReplySyncStatus } from "../types";

export type BadgeTone = "green" | "gray" | "red" | "amber" | "blue" | "slate";

export const KIND_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
    human: { label: "회신", tone: "green" },
    auto_reply: { label: "자동응답", tone: "gray" },
    bounce: { label: "반송", tone: "red" },
    system: { label: "시스템 안내", tone: "slate" },
    internal: { label: "내부 직원", tone: "blue" },
    unknown: { label: "알 수 없음", tone: "amber" },
};

export const KIND_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "human", label: "사람 회신" },
    { value: "auto_reply", label: "자동응답" },
    { value: "bounce", label: "반송" },
    { value: "system", label: "시스템 안내" },
    { value: "internal", label: "내부 직원" },
    { value: "unknown", label: "알 수 없음" },
];

export const MATCH_LABELS: Record<string, string> = {
    matched: "이어짐",
    unmatched: "미분류",
    ambiguous: "애매함",
};

const METHOD_LABELS: Record<string, string> = {
    thread: "스레드 머리글",
    dsn_headers: "반송 안내의 원본 머리글",
    dsn_fallback: "반송된 주소·7일",
    fallback_subject: "보낸 사람·제목",
    fallback_latest: "보낸 사람·가장 최근 발송",
    fallback_from_only: "보낸 사람만 (예전 기록)",
    fallback_multi_ws: "여러 사업에 걸침",
    fallback_multi_org: "여러 조직에 걸침",
};

const BOUNCE_LABELS: Record<string, string> = {
    hard: "주소 없음 (영구)",
    expired: "재시도 끝남",
    soft: "일시 실패",
    unknown: "자세한 사유 없음",
};

export function kindLabel(kind: string): { label: string; tone: BadgeTone } {
    return KIND_LABELS[kind] ?? { label: kind, tone: "gray" };
}

export function matchMethodLabel(method: string | null): string {
    if (!method) return "—";
    return METHOD_LABELS[method] ?? method;
}

export function bounceTypeLabel(type: string | null): string {
    if (!type) return "—";
    return BOUNCE_LABELS[type] ?? type;
}

/** "AI 규칙 이름 · 1번째 후속" / "직접 보낸 메일 · 첫 메일" */
export function ruleStepText(r: Pick<ReplyItem, "ruleKind" | "ruleName" | "ruleId" | "stepIndex" | "matchStatus">): string {
    if (r.matchStatus !== "matched") return "—";
    const rule =
        r.ruleKind === "ai"
            ? `AI · ${r.ruleName ?? `규칙 #${r.ruleId ?? "-"}`}`
            : r.ruleKind === "template"
              ? `템플릿 · ${r.ruleName ?? `규칙 #${r.ruleId ?? "-"}`}`
              : "직접 보낸 메일";
    const step = !r.stepIndex ? "첫 메일" : `${r.stepIndex}번째 후속`;
    return `${rule} · ${step}`;
}

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 효과 한 줄: on이면 멈춘 수, dry_run이면 "멈출 예정" */
export function effectsText(r: Pick<ReplyItem, "effects" | "effectsAppliedAt" | "detectedMode" | "kind" | "matchStatus">): string {
    const e = r.effects ?? {};
    if (r.kind === "bounce") {
        if (e.bounceSignalSkipped) return "반송 신호 대기 (발신 건강 표 배포 뒤 적용)";
        const signals = num(e.bounceSignals);
        const failed = num(e.logMarkedFailed);
        if (!r.effectsAppliedAt) return signals > 0 ? `시험 모드 — 반송 신호 ${signals}건 기록 (발송 기록은 그대로)` : "반송 신호 없음";
        return `반송 신호 ${signals}건 · 발송 실패 처리 ${failed}건`;
    }
    if (r.kind !== "human" || r.matchStatus !== "matched") return "기록만 (자동 메일을 멈추지 않음)";
    const body = `후속 ${num(e.followupsCancelled)}통 · 템플릿 ${num(e.automationCancelled)}건 · 대기열 ${num(e.sendQueueSkipped)}건`;
    if (!r.effectsAppliedAt) return `멈출 예정 (시험 모드): ${body}`;
    return `멈춤: ${body}`;
}

export function formatKstDateTime(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export interface BannerView {
    tone: "ok" | "warn" | "error";
    title: string;
    lines: string[];
}

const MODE_TEXT: Record<string, string> = { off: "꺼짐", dry_run: "시험 모드(dry_run)", on: "켜짐(on)" };
const ALERT_TEXT: Record<string, string> = { off: "알림 꺼짐", dry_run: "알림 미리보기만", live: "알림 보냄" };

/** 회신 탭 위 띠 (11절 1번) */
export function syncBanner(s: ReplySyncStatus | null | undefined): BannerView | null {
    if (!s) return null;
    if (s.tableMissing) {
        return { tone: "error", title: "회신 표가 아직 없습니다 — 서버 마이그레이션(0074)을 확인해 주세요", lines: [] };
    }
    if (!s.configured) {
        return {
            tone: "warn",
            title: "회신 메일함이 연결되지 않았습니다",
            lines: ["REPLY_GOOGLE_CLIENT_ID·REPLY_GOOGLE_CLIENT_SECRET·REPLY_GOOGLE_REFRESH_TOKEN을 서버 환경 변수에 넣어 주세요"],
        };
    }
    const lines: string[] = [];
    if (s.excluded.length > 0) {
        lines.push(`우리 주소에서 뺀 주소 ${s.excluded.length}개 (메일함 쪽 주소) — 이 주소로 온 회신은 읽지 않습니다. 샌드비 발신 주소가 맞으면 REPLY_SHARED_DOMAIN_ADDRESSES에 적어 주세요`);
    }
    lines.push(...s.warnings);
    if (s.errorCode) {
        return {
            tone: "error",
            title: `${s.errorText ?? "회신 읽기 오류"} (마지막 성공 ${formatKstDateTime(s.lastSuccessAt)})`,
            lines,
        };
    }
    const title = `${MODE_TEXT[s.mode] ?? s.mode} · ${ALERT_TEXT[s.alertMode] ?? s.alertMode} · 마지막 확인 ${formatKstDateTime(s.lastSuccessAt ?? s.lastRunAt)} · 메일함 ${s.mailboxMasked}${s.backfillDone ? "" : " · 지난 메일 거슬러 읽는 중"}`;
    return { tone: s.mode === "on" && s.warnings.length === 0 ? "ok" : "warn", title, lines };
}
