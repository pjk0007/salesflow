/** 방문 감사 메일의 조건·문구·예약 시각. DB/외부 요청 없음. */
import { isProductionServer, contactKindOf } from "./deep-visitor-alert-rules";
import type { JourneyCardInput } from "./customer-journey-card";
import { measuredSessionSeconds } from "./tracker-session-duration";

type Env = Record<string, string | undefined>;
export const VISIT_ACK_SOURCE = "visit_ack";
export const VISIT_ACK_STOP_REASON = "site_visit";
export const VISIT_ACK_SUBJECT = "방문해 주셔서 감사합니다";
export const VISIT_ACK_MAX_AGE_MS = 7 * 86400_000;
export const VISIT_ACK_MIN_SECONDS = 7;

export function visitAckConfig(env: Env) {
    const requested = (env.EMAIL_VISIT_ACK_MODE ?? "off").trim();
    const ids = [
        ...new Set(
            (env.EMAIL_VISIT_ACK_WORKSPACE_IDS ?? "")
                .split(",")
                .map(Number)
                .filter((v) => Number.isSafeInteger(v) && v > 0),
        ),
    ];
    const raw = env.EMAIL_VISIT_ACK_START_AT ?? "";
    const startAt = /(?:Z|[+-]\d\d:\d\d)$/.test(raw)
        ? new Date(raw)
        : new Date(NaN);
    const valid = ids.length > 0 && Number.isFinite(startAt.getTime());
    const mode =
        valid && requested === "live" && isProductionServer(env)
            ? "live"
            : valid && requested === "dry_run"
              ? "dry_run"
              : "off";
    return {
        mode,
        ids,
        startAt,
        configurationError:
            requested !== "off" &&
            (!valid || !["live", "dry_run"].includes(requested)),
    };
}

/** 페이지 이동 간격·영역 시간 합계·현재 시각으로 체류를 만들어 내지 않는다. */
export function measuredVisitSeconds(
    input: JourneyCardInput,
    now: Date,
): number | null {
    return measuredSessionSeconds(input.session, now);
}

/** 주말·업무시간 밖이면 다음 평일 09시 이후로 옮기며 선택한 지연의 무작위 간격을 보존한다. */
export function nextVisitAckBusinessTime(date: Date, spreadMs = 0): Date {
    const shifted = new Date(date.getTime() + 9 * 3600_000);
    const hour = shifted.getUTCHours();
    const day = shifted.getUTCDay();
    if (day !== 0 && day !== 6 && hour >= 9 && hour < 18) return date;
    if (hour >= 18) shifted.setUTCDate(shifted.getUTCDate() + 1);
    shifted.setUTCHours(9, 0, 0, 0);
    while ([0, 6].includes(shifted.getUTCDay()))
        shifted.setUTCDate(shifted.getUTCDate() + 1);
    return new Date(
        shifted.getTime() -
            9 * 3600_000 +
            Math.max(0, Math.min(spreadMs, 30 * 60_000)),
    );
}

export function visitAckScheduledAt(now: Date, random = Math.random): Date {
    const sample = Math.max(0, Math.min(1, random()));
    const extra = Math.floor(sample * 30 * 60_000);
    return nextVisitAckBusinessTime(
        new Date(now.getTime() + 30 * 60_000 + extra),
        extra,
    );
}

const escapeHtml = (v: string) =>
    v
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
export function visitAckBody(fields: JourneyCardInput["fields"]) {
    const name = fields
        .find((f) => contactKindOf(f) === "name")
        ?.value.trim()
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 80);
    const greeting =
        name && !name.includes("@")
            ? `안녕하세요, ${name.replace(/님$/, "")}님.`
            : "안녕하세요.";
    return [
        greeting,
        "다소 갑작스러운 메일에도 방문해 주셔서 감사합니다.",
        "혹시 더 궁금한 점은 없으실까요?",
        "언제든지 전화나 답장 주시면 친절히 안내드리겠습니다.",
        "감사합니다.",
    ]
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("\n");
}
