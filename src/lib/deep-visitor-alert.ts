/**
 * 깊이 들어온 사람 알림 — DB 워커와 미리보기.
 *
 * 판정 규칙은 deep-visitor-alert-rules.ts(DB 모름)에 있다. 여기서는 그 입력을 DB에서 모으고,
 * 결과를 deep_visitor_alerts에 남긴 뒤 구글 챗으로 보낸다.
 * 정기 작업과 미리보기가 같은 탐지·근거 함수를 쓴다 — 미리보기에서 본 카드가 실제로 나갈 카드여야 한다.
 *
 * 설계: docs/2026-10-02-deep-visitor-alert/DESIGN.md 4·6·7절.
 */
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, queryClient, deepVisitorAlerts, trackerEvents, trackerFunnels, emailSendLogs } from "@/lib/db";
import type { DeepVisitorAlert } from "@/lib/db";
import {
    emailKeysOf,
    emailPairsByKey,
    eventLabelsOf,
    resolveFieldDefs,
    toCandidateRow,
    type CandidateJson,
    type FieldDefJson,
    type FieldDefRow,
    funnelFieldStagesOf,
    groupByOrg,
    needsPostDetectionDelivery,
    siteVisitorKey,
    splitCandidateRows,
    type CandidateRow,
    type SiteAlias,
    type SiteFunnel,
} from "@/lib/deep-visitor-alert-batch";
import { isDeadlineExceeded } from "@/lib/email-send-queue-rules";
import { postGoogleChatText } from "@/lib/google-chat";
import {
    LOOKBACK_MS,
    HUMAN_CLICK_AFTER_MS,
    MAX_ATTEMPTS,
    STUCK_THRESHOLD_MS,
    DEADLINE_BUDGET_MS,
    PRE_DELIVERY_BUDGET_MS,
    STALE_AFTER_MS,
    RUN_INTERVAL_MS,
    EMAIL_TRIM_CHARS,
    evaluateSendWithFallback,
    pickChosenSession,
    humanClickFallbackSession,
    decideAlert,
    deadlineText,
    nextAlertTime,
    isLevelUpgrade,
    isSubmitSignal,
    isFunnelRecordEvent,
    isRecordInFunnel,
    normalizeEmail,
    buildUnsubscribeIndex,
    isUnsubscribedBy,
    summarizeVisitorClicks,
    recheckSkipReason,
    rotateStart,
    buildAlertMessage,
    resolveAlertConfig,
    listTypeOf,
    type AlertEvidence,
    type AlertEmailEvidence,
    type ClickInput,
    type DeepAlertAngle,
    type DeepAlertConfig,
    type DeepAlertLevel,
    type DeepAlertMode,
    type EventInput,
    type FunnelFieldStage,
    type JourneyVerdict,
    type SendJourneyInput,
    type SessionInput,
    type UnsubscribeRow,
} from "@/lib/deep-visitor-alert-rules";
import {
    NO_WEBHOOK_ERROR,
    deliverClaimedBatch,
    type ClaimedAlert,
    type DeliveryDeps,
} from "@/lib/deep-visitor-alert-delivery";

/** scheduled-registration(…01)·email-send-queue(…02)와 다른 키 — 세 잡은 서로 막지 않아야 한다. */
const LOCK_KEY = 0x5c4edf03;
/**
 * 미리보기 전용 키. 정기 작업 키(…03)를 같이 쓰면 미리보기가 도는 동안 정기 작업이 그 회차를 건너뛴다.
 * 미리보기는 email_send_logs·워크스페이스 레코드를 인덱스 없이 훑으므로 한 번에 하나만 돌게 한다
 */
const PREVIEW_LOCK_KEY = 0x5c4edf04;

const DELIVERY_BATCH = 20;
const FIELD_VALUE_MAX = 120;
const EVENT_LOOKBEHIND_MS = 60 * 1000;
/** 보내기 전 재확인에서 제출·가입 신호를 찾을 범위: 탐지 1시간 전부터 (늦게 들어온 이벤트까지) */
const SUBMIT_RECHECK_LOOKBEHIND_MS = 60 * 60 * 1000;
const STALE_ERROR = "오래되어 보내지 않음 (예약 시각 24시간 지남)";
const STUCK_ERROR = "처리 중 멈춤 — 되돌림";

/**
 * 조회를 보낼 연결. 정기 작업·미리보기는 락을 잡은 전용 연결(reserve) 하나로 모든 조회를 보낸다 —
 * 연결마다 표 정보를 따로 읽어 계획을 세우므로 한 연결에 모으면 계획 비용이 한 번만 든다.
 * 목록은 배열 매개변수 하나(sql.param(목록) = ANY(...))로 넘긴다 — 줄마다 매개변수를 만들지 않아 문장 짓기·계획이 가볍고 길이 제한이 없다.
 */
type Exec = typeof queryClient;

const pgDialect = new PgDialect();

/**
 * drizzle sql을 exec 연결에서 이름 없는 문장으로 돌린다 (db.execute와 같은 방식 — 매번 그 값으로 계획을 세운다).
 * 이름 붙인 문장(태그 템플릿)은 같은 연결에서 다섯 번째부터 값을 모르는 공용 계획으로 바뀌어 배열 조회가 몇 배 느려졌다.
 * 시각은 ISO 문자열로 넘기고 형을 붙인다 — drizzle이 시각 직렬화를 꺼 두었다. 결과의 시각은 문자열로 온다 (toDate).
 */
async function runSql<T>(exec: Exec, query: SQL): Promise<T[]> {
    const q = pgDialect.sqlToQuery(query);
    return (await exec.unsafe(q.sql, q.params as never[])) as unknown as T[];
}

// ============================================
// 공개 타입
// ============================================

export interface DeepAlertRunStats {
    mode: DeepAlertMode;
    noWorkspaces?: boolean;
    tableMissing?: boolean;
    skippedAsLocked?: boolean;
    deadlineHit?: boolean;
    /** 최근 세션으로 찾은 레코드 수 */
    candidates: number;
    /** 판정한 (레코드, 발송) 수 */
    evaluated: number;
    /** 새로 남긴 알림 줄 수 */
    created: number;
    /** 알림을 만들지 않은 레코드의 이유별 수 (already_alerted = 같은 수준 이상이 이미 있음) */
    skippedByReason: Record<string, number>;
    sent: number;
    failed: number;
    requeued: number;
    reclaimed: number;
    /** 보내기 전에 닫은 줄 (웹훅 없음·보내기 전 재확인) */
    skippedAtSend: number;
    /** 웹훅 설정 오류(401·403·404)로 보내지 않고 pending으로 되돌린 줄 */
    deferred: number;
    /** 예약 시각이 24시간 넘게 지나 보내지 않고 닫은 줄 */
    expired: number;
    /** 탐지 중 오류가 나 건너뛴 워크스페이스 (다른 워크스페이스·발송은 계속한다) */
    failedWorkspaces?: number[];
}

export interface DeepAlertPreviewResult {
    /** 다른 미리보기가 도는 중이라 이번 요청은 하지 않았다 */
    busy?: boolean;
    candidates: number;
    items: {
        recordId: number;
        level: DeepAlertLevel;
        angle: DeepAlertAngle;
        deepestStage: number;
        message: string;
    }[];
    skippedByReason: Record<string, number>;
}

// ============================================
// 내부 타입
// ============================================

interface TargetWorkspace {
    id: number;
    orgId: string;
    name: string;
    defaultFieldTypeId: number | null;
}

/** 탐지 대상 워크스페이스와 그 사이트 설정 (loadWorkspaceContexts가 한 문장으로 읽는다) */
interface WorkspaceContext extends TargetWorkspace {
    /** 활성 트래커 사이트 (워크스페이스당 하나). 없으면 null — 탐지하지 않는다 */
    siteId: number | null;
    /** 그 사이트의 퍼널 전부 (id 순) — 4절 깔때기 단계·카드 CUSTOM 라벨 */
    funnels: SiteFunnel[];
    /** 그 사이트의 SECTION_VIEW·CLICK·CUSTOM 별칭 (id 순) — 카드 라벨 */
    aliases: SiteAlias[];
    /** 그 워크스페이스에서 메일 주소를 담는 칸 키 ('email' 포함) */
    emailKeys: string[];
}

/** 자기 사이트가 있는 탐지 대상 */
interface SiteTarget extends WorkspaceContext {
    siteId: number;
}

interface RecordRow {
    id: number;
    workspaceId: number;
    partitionId: number;
    integratedCode: string | null;
    createdAt: Date;
    data: Record<string, unknown>;
}

interface SendRow {
    id: number;
    recordId: number | null;
    sentAt: Date;
    recipientEmail: string;
}

/** 발송 한 통의 판정 재료 (방문자 쪽 재료는 묶음 조회 뒤에 채운다) */
interface SendPrep {
    send: SendRow;
    recordId: number;
    clicks: ClickInput[];
    found: SessionInput[];
    /** 고른 세션 (자기 사이트 가장 이른 세션, 규칙 파일 pickChosenSession) */
    chosen: SessionInput | null;
    /** 고른 세션이 기계로 판정되면 다시 판정할 사람 클릭 세션 (humanClickFallbackSession) */
    fallback: SessionInput | null;
    /** 그 발송의 첫 클릭 (now까지) */
    start: Date | null;
}

/** 4절 판정 한 건의 대상: 레코드와 그 방문자·받는 메일 */
interface GuardItem {
    recordId: number;
    visitorId: number | null;
    recipientEmail: string | null;
}

/** 4절 "이미 깔때기 안"·수신거부 재료. 탐지와 보내기 전 재확인이 같이 쓴다 */
interface AudienceGuards {
    funnelStages: FunnelFieldStage[];
    /** 대상·이어진·같은 메일 레코드 (조직 확인을 거친 것만) */
    recordRows: Map<number, RecordRow>;
    relatedOf: (item: GuardItem) => number[];
    alreadyInFunnel: (item: GuardItem) => boolean;
    unsubscribed: (item: GuardItem) => boolean;
}

interface DeepAlertCandidate {
    recordId: number;
    sendLogId: number;
    input: SendJourneyInput;
    verdict: JourneyVerdict;
    level: DeepAlertLevel;
    angle: DeepAlertAngle;
    sentAt: Date;
    /** 같은 워크스페이스에서 이 사람으로 이어진 다른 레코드 (방문자 연결·같은 메일) */
    otherRecordIds: number[];
}

interface WorkspaceDetection {
    ws: WorkspaceContext;
    siteId: number;
    funnelStages: FunnelFieldStage[];
    /** 4절 재료를 읽은 레코드(알림이 될 수 있는 후보)와 그 연결·같은 메일 레코드 (조직 확인을 거친 것만) */
    recordRows: Map<number, RecordRow>;
    alerts: DeepAlertCandidate[];
    candidates: number;
    evaluated: number;
    skippedByReason: Record<string, number>;
}

interface DetectedAlert extends DeepAlertCandidate {
    message: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ============================================
// 정기 작업
// ============================================

/**
 * 5분마다 외부 스케줄러가 부른다 (POST /api/tracker/deep-alerts/process).
 *
 * 한 회차가 모든 후보를 다 처리할 필요는 없다 — 예산(4분)을 쓰면 남은 건 다음 회차가 다시 찾는다.
 * 탐지는 매번 최근 48시간을 새로 보고, 이미 남긴 (레코드, 수준)은 유니크 키가 막아 두 번 생기지 않는다.
 *
 * 조회 수를 줄이려고 서로 기대지 않는 일을 한 문장에 묶는다 (결과는 따로 할 때와 같다):
 *   첫 문장(runStart) = 락 잡기 + 멈춘 줄 되돌리기 + 묵은 줄 닫기 + 첫 발송 묶음 집기 + 탐지 대상 설정 + 후보.
 *     락을 잡았을 때만 쓰고 후보를 읽는다. 멈춘 줄이 있으면 닫기·집기는 예전처럼 되돌린 뒤 따로 한다 (expireStaleAndClaim).
 *     후보는 이 문장에서 읽은 알림 수준을 쓴다 — 저장 문장이 같은 레코드의 intent를 다시 보고 막으므로(persistAlerts)
 *     락을 잡기 직전에 끝난 워커가 남긴 알림과 겹쳐도 결과가 같다.
 *   탐지 앞 발송이 줄을 집었으면 탐지 재료는 발송 뒤에 새로 읽는다 (예전 순서 그대로 — 그사이 들어온 방문을 놓치지 않게).
 *   첫 문장이 표 없음 말고 다른 이유로 실패하면 예전처럼 나눠서 한다 — 한 워크스페이스의 오류가 회차 전체를 막지 않게.
 *   탐지 뒤 발송은 집을 줄이 있을 때만 (needsPostDetectionDelivery)
 */
export async function processDeepVisitorAlerts(
    opts: { now?: Date; env?: Record<string, string | undefined> } = {}
): Promise<DeepAlertRunStats> {
    const env = opts.env ?? process.env;
    const config = resolveAlertConfig(env);
    const now = opts.now ?? new Date();
    const stats: DeepAlertRunStats = {
        mode: config.mode,
        candidates: 0,
        evaluated: 0,
        created: 0,
        skippedByReason: {},
        sent: 0,
        failed: 0,
        requeued: 0,
        reclaimed: 0,
        skippedAtSend: 0,
        deferred: 0,
        expired: 0,
    };

    if (config.mode === "off") return stats;
    // 여러 조직이 쓰는 서비스다 — 허용 목록이 비면 아무 조직의 고객 정보도 챗으로 보내지 않는다
    if (config.workspaceIds.length === 0) {
        console.log("[deep-alert] 허용 워크스페이스 없음, 건너뜀");
        return { ...stats, noWorkspaces: true };
    }

    // 락을 잡은 커넥션에서 풀어야 하므로 전용 커넥션을 확보한다 (email-send-queue와 같은 이유)
    const conn = await queryClient.reserve();
    // 락 문장이 실행 중에 실패하면 락을 잡았는지 알 수 없다 (세션 락은 문장이 실패해도 남는다) → 끝에 풀어 본다
    let lockState: "held" | "not_held" | "unknown" = "unknown";

    try {
        let start: RunStart | null = null;
        try {
            start = await runStart(conn, now, config);
            lockState = start.acquired ? "held" : "not_held";
        } catch (e) {
            // 마이그레이션이 실패해도 서버는 켜진다 → 표가 없으면 조용히 알리고 끝낸다 (문장을 읽다 실패해 락은 잡지 않았다)
            if (isAlertTableMissing(e)) {
                lockState = "not_held";
                console.warn("[deep-alert] deep_visitor_alerts 표가 없음 (마이그레이션 확인 필요)");
                return { ...stats, tableMissing: true };
            }
            // 묶은 문장이 도중에 실패했다 — 쓴 것은 되돌려졌지만 세션 락은 남았을 수 있다. 풀고 예전처럼 나눠서 한다
            console.error(`[deep-alert] 첫 문장 실패, 나눠서 다시: ${describeDeepAlertError(e)}`);
            await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
            const lockResult = await conn<{ acquired: boolean; reclaimed: number }[]>`
                WITH lk AS (SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok),
                rc AS (
                    UPDATE deep_visitor_alerts
                    SET status = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN 'pending' ELSE 'failed' END,
                        locked_at = NULL,
                        last_error = ${STUCK_ERROR}
                    WHERE (SELECT ok FROM lk)
                      AND status = 'processing'
                      AND locked_at < NOW() - (${STUCK_THRESHOLD_MS}::bigint * INTERVAL '1 millisecond')
                    RETURNING id
                )
                SELECT (SELECT ok FROM lk) AS acquired, (SELECT count(*)::int FROM rc) AS reclaimed
            `;
            lockState = lockResult[0]?.acquired === true ? "held" : "not_held";
            if (lockState === "held") {
                // 닫기·집기는 아래에서 예전처럼 따로 한다
                start = {
                    acquired: true,
                    reclaimed: Number(lockResult[0]?.reclaimed ?? 0),
                    claimLater: true,
                    expired: 0,
                    firstBatch: [],
                    prefetched: null,
                };
            }
        }
        if (lockState !== "held" || start === null) {
            console.log("[deep-alert] 다른 워커가 도는 중, 건너뜀");
            return { ...stats, skippedAsLocked: true };
        }
        stats.reclaimed = start.reclaimed;
        if (start.reclaimed > 0) console.log(`[deep-alert] reclaimed ${start.reclaimed} stuck rows`);
        // 멈춘 줄을 되돌렸으면 닫기·집기는 그 뒤에 따로 한다 — 되돌린 줄도 예전처럼 이번 회차 첫 묶음에 들어가게
        let { expired, firstBatch } = start;
        if (start.claimLater && config.mode === "live") ({ expired, firstBatch } = await expireStaleAndClaim(now, config.workspaceIds));
        else if (expired > 0) console.log(`[deep-alert] expired ${expired} stale rows`);

        const startedAt = Date.now();
        const overBudget = () => isDeadlineExceeded(startedAt, Date.now(), DEADLINE_BUDGET_MS);

        // 웹훅 주소는 비밀값이다 — 로그에는 있음/없음만 남긴다
        const webhookNote = config.workspaceIds
            .map((id) => `${id}(${config.webhookByWorkspace[id] ? "웹훅 있음" : "웹훅 없음"})`)
            .join(",");
        console.log(`[deep-alert] mode=${config.mode} workspaces=${webhookNote}`);

        try {
            // 발송이 실패해도 탐지는 한다 (탐지 결과는 남고 다음 회차에 나간다). 오류는 끝에 다시 던져 500으로 드러낸다
            let deliveryError: unknown = null;
            let preDeliveryClaimedAny = false;
            if (config.mode === "live") {
                stats.expired = expired;
                // 이미 예약된 줄(월 09:00 몫·재시도)을 탐지보다 먼저 보낸다 — 탐지가 예산을 다 쓰거나
                // 한 워크스페이스에서 실패해도 밀린 알림은 나가게. 탐지 몫을 남기려고 짧은 예산만 쓴다
                const preStartedAt = Date.now();
                try {
                    const pre = await deliverDue(
                        now,
                        config,
                        stats,
                        () => overBudget() || isDeadlineExceeded(preStartedAt, Date.now(), PRE_DELIVERY_BUDGET_MS),
                        firstBatch
                    );
                    preDeliveryClaimedAny = pre.claimedAny;
                } catch (e) {
                    if (isAlertTableMissing(e)) throw e;
                    console.error(`[deep-alert] 발송 실패, 탐지는 계속: ${describeDeepAlertError(e)}`);
                    deliveryError = e;
                }
            }
            // 탐지 앞 발송이 줄을 집었으면(그사이 시간이 흘렀다) 첫 문장의 재료를 버리고 새로 읽는다
            const prefetched = preDeliveryClaimedAny || firstBatch.length > 0 ? null : start.prefetched;
            const createdDueNow = await detectAndPersist(now, config, env, stats, overBudget, conn, prefetched);
            if (overBudget()) stats.deadlineHit = true;
            // 탐지에서 예산을 다 썼으면 새 줄은 다음 회차 앞머리에 보낸다 — 주기(5분)를 넘겨 겹치지 않게
            if (
                config.mode === "live" &&
                !stats.deadlineHit &&
                deliveryError === null &&
                needsPostDetectionDelivery({ preDeliveryClaimedAny, createdDueNow })
            ) {
                const delivery = await deliverDue(now, config, stats, overBudget);
                if (delivery.budgetHit) stats.deadlineHit = true;
            }
            if (deliveryError !== null) throw deliveryError;
        } catch (e) {
            // 마이그레이션이 실패해도 서버는 켜진다 → 표가 없으면 조용히 알리고 끝낸다
            if (isAlertTableMissing(e)) {
                console.warn("[deep-alert] deep_visitor_alerts 표가 없음 (마이그레이션 확인 필요)");
                return { ...stats, tableMissing: true };
            }
            throw e;
        }

        console.log(
            `[deep-alert] candidates=${stats.candidates} evaluated=${stats.evaluated} created=${stats.created} ` +
            `sent=${stats.sent} failed=${stats.failed} requeued=${stats.requeued} reclaimed=${stats.reclaimed} ` +
            `skippedAtSend=${stats.skippedAtSend} deferred=${stats.deferred} expired=${stats.expired} ` +
            `skipped=${JSON.stringify(stats.skippedByReason)}` +
            `${stats.failedWorkspaces?.length ? ` failedWorkspaces=${stats.failedWorkspaces.join(",")}` : ""}` +
            `${stats.deadlineHit ? " deadlineHit" : ""}`
        );
        return stats;
    } finally {
        if (lockState === "held") {
            await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
        } else if (lockState === "unknown") {
            // 락 문장이 실행 중에 실패했다 — 잡았을 수도 있으니 풀어 본다 (안 잡았으면 경고만 남고 끝난다).
            // 원래 오류를 덮지 않게 여기서 난 오류는 로그만 남긴다
            await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch((e: unknown) => {
                console.error(`[deep-alert] 락 풀기 실패: ${describeDeepAlertError(e)}`);
            });
        }
        conn.release();
    }
}

/**
 * 같은 조직의 허용 워크스페이스를 묶어 탐지하고 새 알림을 남긴다. 돌려주는 값: 새로 남긴 줄 중 지금 보낼 줄 수
 * (pending이고 예약 시각이 지금 이전 — 탐지 뒤 발송을 할지 정한다).
 *
 * 묶음 하나가 실패하면 그 묶음의 워크스페이스를 하나씩 다시 탐지한다 — 한 워크스페이스의 일시 오류로 다른
 * 워크스페이스 탐지·발송까지 멈추지 않게 (예전처럼 워크스페이스마다 따로 실패한다). 저장은 유니크 키로 막으므로
 * 다시 탐지해도 두 번 생기지 않는다. 하나씩 다시 할 때는 후보를 새로 읽는다 (예전처럼).
 *
 * prefetched: 첫 문장(runStart)에서 함께 읽은 대상 설정·후보. 없으면 여기서 읽는다 (설정 한 문장 + 조직마다 후보 한 문장).
 */
async function detectAndPersist(
    now: Date,
    config: DeepAlertConfig,
    env: Record<string, string | undefined>,
    stats: DeepAlertRunStats,
    overBudget: () => boolean,
    exec: Exec,
    prefetched: Prefetched | null
): Promise<number> {
    const targets = prefetched?.contexts ?? (await loadWorkspaceContexts(exec, config.workspaceIds));
    const baseUrl = baseUrlOf(env);
    let createdDueNow = 0;

    // 시작 워크스페이스를 회차마다 돌린다 — 탐지가 예산에 걸려도 번호가 큰 워크스페이스가 늘 굶지 않게
    const rotated = rotateStart(targets, Math.floor(now.getTime() / RUN_INTERVAL_MS));
    const withSite: SiteTarget[] = [];
    for (const ws of rotated) {
        if (ws.siteId === null) console.log(`[deep-alert] workspace=${ws.id} 활성 트래커 사이트 없음, 건너뜀`);
        else withSite.push({ ...ws, siteId: ws.siteId });
    }

    const detectAndSave = async (group: SiteTarget[], candidates: CandidateRow[] | null): Promise<void> => {
        const rows = candidates ?? (await loadCandidateRows(exec, now, group));
        const dets = await detectGroup(now, group, rows, exec);
        const withAlerts = dets.filter((d) => d.alerts.length > 0);
        const alerts = await attachMessages(now, withAlerts, baseUrl, exec);
        const saved = await persistAlerts(now, withAlerts, alerts, config, exec);
        // 묶음 전체가 끝난 뒤에만 센다 — 실패해 하나씩 다시 할 때 두 번 세지 않게
        for (const det of dets) {
            stats.candidates += det.candidates;
            stats.evaluated += det.evaluated;
            mergeCounts(stats.skippedByReason, det.skippedByReason);
        }
        stats.created += saved.created;
        createdDueNow += saved.dueNow;
    };

    for (const group of groupByOrg(withSite)) {
        if (overBudget()) {
            stats.deadlineHit = true;
            break;
        }
        try {
            await detectAndSave(group, prefetched?.candidates ?? null);
            continue;
        } catch (e) {
            // 표가 없으면 회차 전체가 할 일이 없다 — 바깥에서 tableMissing으로 끝낸다
            if (isAlertTableMissing(e)) throw e;
            if (group.length === 1) {
                console.error(`[deep-alert] workspace=${group[0].id} 탐지 실패, 다음 워크스페이스로: ${describeDeepAlertError(e)}`);
                (stats.failedWorkspaces ??= []).push(group[0].id);
                continue;
            }
            console.error(
                `[deep-alert] workspaces=${group.map((w) => w.id).join(",")} 묶어 탐지 실패, 하나씩 다시: ${describeDeepAlertError(e)}`
            );
        }
        for (const ws of group) {
            if (overBudget()) {
                stats.deadlineHit = true;
                break;
            }
            try {
                await detectAndSave([ws], null);
            } catch (e) {
                if (isAlertTableMissing(e)) throw e;
                // 한 워크스페이스의 일시 오류로 다른 워크스페이스 탐지·발송까지 멈추지 않게 한다.
                // 저장은 워크스페이스마다 따로 하고 유니크 키로 막으므로 다음 회차가 다시 찾아도 안전하다
                console.error(`[deep-alert] workspace=${ws.id} 탐지 실패, 다음 워크스페이스로: ${describeDeepAlertError(e)}`);
                (stats.failedWorkspaces ??= []).push(ws.id);
            }
        }
    }
    return createdDueNow;
}

/**
 * 새 알림을 남긴다 (묶음의 워크스페이스 전부를 한 문장으로). onConflictDoNothing이라 같은 (레코드, 수준)이 이미 있으면 넘어간다.
 *
 * dry_run 줄은 나중에 live로 바꿔도 보내지 않는다 (밀린 알림이 한꺼번에 나가지 않게) —
 * 발송은 status='pending'만 집기 때문이다.
 *
 * 줄은 JSON 매개변수 하나로 넘기고 넘긴 순서대로 넣는다 (id 순서가 예전 VALUES와 같다).
 * deep 줄은 이 문장에서 같은 레코드의 intent 줄을 다시 보고, 있으면 넣지 않는다 — 탐지 재료(알림 수준)를 락을 잡는
 * 문장에서 함께 읽으므로, 그 직전에 끝난 워커가 intent를 남겼어도 예전(락 뒤에 읽기)과 같은 결과가 되게.
 * 그 밖에는 탐지가 이미 intent 있는 레코드에 deep을 만들지 않으므로 결과가 같다.
 */
async function persistAlerts(
    now: Date,
    dets: WorkspaceDetection[],
    alertsByDet: DetectedAlert[][],
    config: DeepAlertConfig,
    exec: Exec
): Promise<{ created: number; dueNow: number }> {
    const scheduledAt = nextAlertTime(now);
    const nowIso = now.toISOString();
    const scheduledIso = scheduledAt.toISOString();
    const values = dets.flatMap((det, i) => {
        const hasWebhook = Boolean(config.webhookByWorkspace[det.ws.id]);
        return (alertsByDet[i] ?? []).map((a) => {
            const status = config.mode === "dry_run" ? "dry_run" : hasWebhook ? "pending" : "skipped";
            return {
                org_id: det.ws.orgId,
                workspace_id: det.ws.id,
                site_id: det.siteId,
                record_id: a.recordId,
                send_log_id: a.sendLogId,
                session_id: a.verdict.chosenSession?.id ?? null,
                visitor_id: a.verdict.chosenSession?.visitorId ?? null,
                level: a.level,
                angle: a.angle,
                deepest_stage: a.verdict.deepestStage,
                status,
                last_error: status === "skipped" ? NO_WEBHOOK_ERROR : null,
                message: a.message,
                detected_at: nowIso,
                scheduled_at: scheduledIso,
            };
        });
    });
    if (values.length === 0) return { created: 0, dueNow: 0 };

    const inserted = await runSql<{ id: number; record_id: number; level: string; status: string }>(exec, sql`
        INSERT INTO deep_visitor_alerts
            (org_id, workspace_id, site_id, record_id, send_log_id, session_id, visitor_id, level, angle,
             deepest_stage, status, last_error, message, detected_at, scheduled_at)
        SELECT v.org_id, v.workspace_id, v.site_id, v.record_id, v.send_log_id, v.session_id, v.visitor_id, v.level, v.angle,
               v.deepest_stage, v.status, v.last_error, v.message, v.detected_at, v.scheduled_at
        FROM ROWS FROM (json_to_recordset(${JSON.stringify(values)}::json) AS (
                 org_id uuid, workspace_id int, site_id int, record_id int, send_log_id int, session_id int,
                 visitor_id int, level varchar, angle varchar, deepest_stage int, status varchar, last_error text,
                 message text, detected_at timestamptz, scheduled_at timestamptz
             )) WITH ORDINALITY AS v(org_id, workspace_id, site_id, record_id, send_log_id, session_id, visitor_id, level,
                                     angle, deepest_stage, status, last_error, message, detected_at, scheduled_at, ord)
        WHERE NOT (v.level = 'deep' AND EXISTS (
            SELECT 1 FROM deep_visitor_alerts a WHERE a.record_id = v.record_id AND a.level = 'intent'
        ))
        ORDER BY v.ord
        -- dva_record_level_idx — 이미 같은 수준 알림이 있는 레코드는 다시 만들지 않는다
        ON CONFLICT DO NOTHING
        RETURNING id, record_id, level, status
    `);

    // 줄마다 찍지 않는다 (수백 줄이면 로그 쓰기만으로 느려진다) — 같은 내용을 한 줄에
    if (inserted.length > 0) {
        console.log(
            `[deep-alert] created ${inserted.length}: ` +
            inserted.map((r) => `id=${r.id} record=${r.record_id} level=${r.level} status=${r.status}`).join(", ")
        );
    }
    const dueNow = scheduledAt.getTime() <= now.getTime() ? inserted.filter((r) => r.status === "pending").length : 0;
    return { created: inserted.length, dueNow };
}

/** 첫 문장에서 함께 읽은 탐지 재료 */
interface Prefetched {
    contexts: WorkspaceContext[];
    candidates: CandidateRow[];
}

interface RunStart {
    acquired: boolean;
    reclaimed: number;
    /** 묵은 줄 닫기·첫 묶음 집기를 이 문장에서 하지 않았다 — 멈춘 줄을 되돌렸거나 나눠서 하는 중이라 따로 한다 */
    claimLater: boolean;
    expired: number;
    firstBatch: ClaimedRow[];
    /** 탐지 재료. 나눠서 다시 할 때(첫 문장 실패)는 null */
    prefetched: Prefetched | null;
}

/**
 * 정기 작업 첫 문장: 락 잡기 + 멈춘 줄 되돌리기 + (live) 묵은 줄 닫기 + 첫 발송 묶음 집기 + 탐지 대상 설정 + 후보.
 * 쓰기는 모두 락을 잡았을 때만 한다. 닫기·집기는 멈춘 줄이 없을 때만 한다 — 있으면 되돌린 줄이 pending이 된 뒤에
 * 해야 예전과 같으므로 부른 쪽이 expireStaleAndClaim으로 따로 한다 (드물다: 프로세스가 죽은 뒤 한 번).
 * 각 부분의 조건은 예전 문장(락+되돌리기, expireStaleAndClaim, loadWorkspaceContexts, 후보)과 같다.
 */
async function runStart(conn: Exec, now: Date, config: DeepAlertConfig): Promise<RunStart> {
    const nowIso = now.toISOString();
    const staleBeforeIso = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    const ids = config.workspaceIds;
    const [row] = await runSql<{
        acquired: boolean;
        reclaimed: number;
        had_stuck: boolean;
        expired: number;
        claimed: ClaimedRow[] | null;
        contexts: ContextRow[] | null;
        candidates: CandidateJson[] | null;
    }>(conn, sql`
        WITH lk AS MATERIALIZED (SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok),
        stuck AS MATERIALIZED (
            SELECT id FROM deep_visitor_alerts
            WHERE (SELECT ok FROM lk)
              AND status = 'processing'
              AND locked_at < NOW() - (${STUCK_THRESHOLD_MS}::bigint * INTERVAL '1 millisecond')
        ),
        rc AS (
            UPDATE deep_visitor_alerts
            SET status = CASE WHEN attempts < ${MAX_ATTEMPTS} THEN 'pending' ELSE 'failed' END,
                locked_at = NULL,
                last_error = ${STUCK_ERROR}
            WHERE id IN (SELECT id FROM stuck)
            RETURNING id
        ),
        go AS MATERIALIZED (
            SELECT (SELECT ok FROM lk) AND ${config.mode === "live"}::boolean AND NOT EXISTS (SELECT 1 FROM stuck) AS ok
        ),
        expired AS (
            UPDATE deep_visitor_alerts
            SET status = 'skipped', last_error = ${STALE_ERROR}, locked_at = NULL
            WHERE (SELECT ok FROM go)
              AND status = 'pending'
              AND scheduled_at < ${staleBeforeIso}::timestamptz
              AND workspace_id = ANY(${sql.param(ids)}::int[])
            RETURNING id
        ),
        claimed AS (
            UPDATE deep_visitor_alerts
            SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
            WHERE id IN (
                SELECT id FROM deep_visitor_alerts
                WHERE (SELECT ok FROM go)
                  AND status = 'pending'
                  AND scheduled_at <= ${nowIso}::timestamptz
                  AND scheduled_at >= ${staleBeforeIso}::timestamptz
                  AND workspace_id = ANY(${sql.param(ids)}::int[])
                ORDER BY scheduled_at ASC, id ASC
                LIMIT ${DELIVERY_BATCH}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, org_id, workspace_id, site_id, record_id, send_log_id, visitor_id, level, message, attempts, detected_at
        ),
        ctx AS MATERIALIZED (${contextsSql(ids, undefined)}),
        cand AS (${candidatesSql(now, sql`(SELECT ok FROM lk)`)})
        SELECT (SELECT ok FROM lk) AS acquired,
               (SELECT count(*)::int FROM rc) AS reclaimed,
               EXISTS (SELECT 1 FROM stuck) AS had_stuck,
               (SELECT count(*)::int FROM expired) AS expired,
               (SELECT COALESCE(json_agg(claimed), '[]'::json) FROM claimed) AS claimed,
               (SELECT COALESCE(json_agg(ctx ORDER BY ctx.id), '[]'::json) FROM ctx) AS contexts,
               (SELECT COALESCE(json_agg(cand), '[]'::json) FROM cand) AS candidates
    `);
    return {
        acquired: row?.acquired === true,
        reclaimed: Number(row?.reclaimed ?? 0),
        claimLater: row?.had_stuck === true,
        expired: Number(row?.expired ?? 0),
        firstBatch: [...(row?.claimed ?? [])].sort((a, b) => a.id - b.id),
        prefetched: {
            contexts: (row?.contexts ?? []).map(toWorkspaceContext),
            candidates: (row?.candidates ?? []).map(toCandidateRow),
        },
    };
}

// ============================================
// 발송
// ============================================

interface ClaimedRow {
    id: number;
    org_id: string;
    workspace_id: number;
    site_id: number | null;
    record_id: number;
    send_log_id: number | null;
    visitor_id: number | null;
    level: string;
    message: string;
    attempts: number;
    detected_at: string | Date;
}

/**
 * 예약 시각이 된 pending을 집어 보내기 전에 다시 확인하고 한 통씩 보낸다.
 *
 * 허용 목록에서 빠진 워크스페이스의 줄은 집지 않는다 — 설정을 바꾼 뒤에 그 사업 고객 정보가
 * 챗으로 나가면 안 된다. 웹훅 설정 오류가 난 워크스페이스는 이번 호출 끝까지 집지 않는다.
 * firstBatch: 이미 집어 둔 첫 묶음 (expireStaleAndClaim) — 그 묶음부터 보낸 뒤 이어서 집는다.
 * claimedAny: 한 줄이라도 집었는가 (탐지 뒤 발송을 할지 정한다)
 */
async function deliverDue(
    now: Date,
    config: DeepAlertConfig,
    stats: DeepAlertRunStats,
    overBudget: () => boolean,
    firstBatch?: ClaimedRow[]
): Promise<{ budgetHit: boolean; claimedAny: boolean }> {
    const state = { posted: 0 };
    const broken = new Set<number>();
    const deps: DeliveryDeps = {
        now,
        overBudget,
        webhookFor: (workspaceId) => config.webhookByWorkspace[workspaceId],
        post: postSafely,
        markSent: async (id) => {
            await db
                .update(deepVisitorAlerts)
                .set({ status: "sent", sentAt: new Date(), lastError: null })
                .where(eq(deepVisitorAlerts.id, id));
        },
        markSkipped: async (id, reason) => {
            await db
                .update(deepVisitorAlerts)
                .set({ status: "skipped", lastError: reason.slice(0, 500), lockedAt: null })
                .where(eq(deepVisitorAlerts.id, id));
        },
        markFailed: async (id, error) => {
            await db
                .update(deepVisitorAlerts)
                .set({ status: "failed", lastError: error, lockedAt: null })
                .where(eq(deepVisitorAlerts.id, id));
        },
        requeue: async (id, error, at) => {
            await db
                .update(deepVisitorAlerts)
                .set({ status: "pending", lastError: error, lockedAt: null, scheduledAt: at })
                .where(eq(deepVisitorAlerts.id, id));
        },
        release: releaseClaimed,
        sleep,
        log: (message) => console.log(message),
    };

    let pending = firstBatch;
    let claimedAny = false;
    while (!overBudget()) {
        const workspaceIds = config.workspaceIds.filter((id) => !broken.has(id));
        const batch = pending ?? (await claimBatch(now, workspaceIds));
        pending = undefined;
        if (batch.length === 0) return { budgetHit: false, claimedAny };
        claimedAny = true;

        let skipReasons: Map<number, string>;
        try {
            skipReasons = await recheckClaimed(now, batch);
        } catch (e) {
            // 다시 확인하지 못하면 보내지 않는다 — 집은 줄을 되돌리고 오류를 올린다
            await releaseClaimed(batch.map((r) => r.id)).catch(() => {
                console.warn(`[deep-alert] 재확인 실패 뒤 되돌리기도 실패, ${batch.length}건은 15분 뒤 회수`);
            });
            throw e;
        }

        const tally = await deliverClaimedBatch(batch.map(toClaimedAlert), skipReasons, deps, state);
        stats.sent += tally.sent;
        stats.failed += tally.failed;
        stats.requeued += tally.requeued;
        stats.skippedAtSend += tally.skipped;
        stats.deferred += tally.deferred;
        for (const id of tally.brokenWorkspaces) broken.add(id);
        if (tally.budgetHit) return { budgetHit: true, claimedAny };
    }
    // 집어 둔 첫 묶음을 보내지 못하고 예산이 끝났으면 되돌린다 (processing에 15분 묶이지 않게)
    if (pending && pending.length > 0) {
        claimedAny = true;
        await releaseClaimed(pending.map((r) => r.id));
    }
    return { budgetHit: true, claimedAny };
}

function toClaimedAlert(row: ClaimedRow): ClaimedAlert {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        recordId: row.record_id,
        message: row.message,
        attempts: row.attempts,
    };
}

/** postGoogleChatText는 오류를 돌려주게 돼 있지만, 예외가 새어도 줄이 processing에 묶이지 않게 감싼다 */
async function postSafely(
    webhookUrl: string,
    text: string
): Promise<{ ok: true } | { ok: false; status: number | null; error: string; retryable: boolean }> {
    try {
        return await postGoogleChatText(webhookUrl, text);
    } catch (e) {
        return { ok: false, status: null, error: e instanceof Error ? e.message : String(e), retryable: true };
    }
}

/**
 * 보내기 직전 재확인 (설계 7절 6단계). 근무시간 밖에 탐지한 줄은 다음 평일 09:00까지 기다리므로
 * 그 사이 수신거부·가입했거나 같은 레코드에 intent 카드가 생겼으면 보내지 않는다.
 * 탐지와 같은 함수(loadAudienceGuardsMany·isSubmitSignal)로 본다. 돌려주는 값: 줄 id → 보내지 않을 이유.
 * 서로 기대지 않는 조회(intent 줄·받는 메일·워크스페이스 설정·제출 신호)는 함께 돌린다.
 */
async function recheckClaimed(now: Date, batch: ClaimedRow[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (batch.length === 0) return out;

    // 같은 레코드의 intent 줄 (deep 줄만 본다)
    const deepRecordIds = uniq(batch.filter((r) => r.level !== "intent").map((r) => r.record_id));
    // 받는 메일 주소 (발송 PK 조회)
    const sendIds = uniq(batch.map((r) => r.send_log_id).filter(isPresent));
    const [intentRows, sendRows, contexts, submitted] = await Promise.all([
        deepRecordIds.length
            ? db
                .select({ recordId: deepVisitorAlerts.recordId, status: deepVisitorAlerts.status })
                .from(deepVisitorAlerts)
                .where(and(inArray(deepVisitorAlerts.recordId, deepRecordIds), eq(deepVisitorAlerts.level, "intent")))
            : Promise.resolve([]),
        sendIds.length
            ? db
                .select({ id: emailSendLogs.id, orgId: emailSendLogs.orgId, recipientEmail: emailSendLogs.recipientEmail })
                .from(emailSendLogs)
                .where(inArray(emailSendLogs.id, sendIds))
            : Promise.resolve([]),
        loadWorkspaceContexts(queryClient, uniq(batch.map((r) => r.workspace_id))),
        loadSubmittedSince(now, batch),
    ]);
    const intentStatusesByRecord = groupBy(intentRows, (r) => r.recordId);
    const sendById = new Map(sendRows.map((r) => [r.id, r]));

    // 워크스페이스·사이트마다 4절 재료 — 조직마다 한 번에 읽는다
    const wsById = new Map(contexts.map((w) => [w.id, w]));
    const guardKey = (r: ClaimedRow) => `${r.workspace_id}:${r.site_id ?? ""}`;
    const itemOf = (r: ClaimedRow): GuardItem => {
        const send = r.send_log_id !== null ? sendById.get(r.send_log_id) : undefined;
        return {
            recordId: r.record_id,
            visitorId: r.visitor_id,
            recipientEmail: send && send.orgId === r.org_id ? send.recipientEmail : null,
        };
    };
    const groups: Array<{ key: string; ws: WorkspaceContext; siteId: number | null; items: GuardItem[] }> = [];
    for (const [key, rows] of groupBy(batch, guardKey)) {
        const ws = wsById.get(rows[0].workspace_id);
        if (!ws || ws.orgId !== rows[0].org_id) continue;
        groups.push({ key, ws, siteId: rows[0].site_id, items: rows.map(itemOf) });
    }
    const guardsByKey = new Map<string, AudienceGuards>();
    for (const orgGroups of groupByOrg(groups.map((g) => ({ ...g, orgId: g.ws.orgId })))) {
        const guards = await loadAudienceGuardsMany(queryClient, orgGroups[0].orgId, orgGroups);
        orgGroups.forEach((g, i) => guardsByKey.set(g.key, guards[i]));
    }

    for (const r of batch) {
        const guards = guardsByKey.get(guardKey(r));
        if (!guards) {
            out.set(r.id, "보내기 전 재확인: 워크스페이스를 찾을 수 없음");
            continue;
        }
        const item = itemOf(r);
        const reason = recheckSkipReason({
            level: r.level === "intent" ? "intent" : "deep",
            intentStatuses: (intentStatusesByRecord.get(r.record_id) ?? []).map((x) => x.status),
            alreadyInFunnel: guards.alreadyInFunnel(item),
            unsubscribed: guards.unsubscribed(item),
            submittedSince: submitted.has(r.id),
        });
        if (reason) out.set(r.id, reason);
    }
    return out;
}

/** 탐지 뒤(1시간 여유) 그 방문자가 자기 사이트에 제출·가입 신호를 남긴 줄 id */
async function loadSubmittedSince(now: Date, batch: ClaimedRow[]): Promise<Set<number>> {
    const targets = batch.flatMap((r) => {
        if (r.visitor_id === null || r.site_id === null) return [];
        const detectedAt = toDate(r.detected_at) ?? now;
        return [{
            id: r.id,
            visitorId: r.visitor_id,
            siteId: r.site_id,
            from: new Date(detectedAt.getTime() - SUBMIT_RECHECK_LOOKBEHIND_MS),
        }];
    });
    const out = new Set<number>();
    if (targets.length === 0) return out;

    const events = await db
        .select({
            visitorId: trackerEvents.visitorId,
            siteId: trackerEvents.siteId,
            eventType: trackerEvents.eventType,
            eventName: trackerEvents.eventName,
            pageUrl: trackerEvents.pageUrl,
            occurredAt: trackerEvents.occurredAt,
        })
        .from(trackerEvents)
        .where(and(
            inArray(trackerEvents.eventType, ["PAGE_VIEW", "CLICK", "CUSTOM"]),
            lte(trackerEvents.occurredAt, now),
            or(...targets.map((t) => and(
                eq(trackerEvents.visitorId, t.visitorId),
                eq(trackerEvents.siteId, t.siteId),
                gte(trackerEvents.occurredAt, t.from),
            ))),
        ));
    for (const t of targets) {
        const hit = events.some(
            (e) =>
                e.visitorId === t.visitorId &&
                e.siteId === t.siteId &&
                e.occurredAt.getTime() >= t.from.getTime() &&
                isSubmitSignal(e)
        );
        if (hit) out.add(t.id);
    }
    return out;
}

/** claimBatch·expireStaleAndClaim이 돌려주는 칸 */
const CLAIMED_COLUMNS = sql.raw(
    "id, org_id, workspace_id, site_id, record_id, send_log_id, visitor_id, level, message, attempts, detected_at"
);

/**
 * pending을 원자적으로 선점한다. attempts를 여기서 올리는 이유는 email_send_queue와 같다 —
 * 처리 중 프로세스가 죽어도 시도가 기록되어야 한다. 예약 시각이 24시간 넘게 지난 줄은 집지 않는다 (expireStaleAndClaim이 닫는다).
 */
async function claimBatch(now: Date, workspaceIds: number[]): Promise<ClaimedRow[]> {
    if (workspaceIds.length === 0) return [];
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    const rows = (await db.execute(sql`
        UPDATE deep_visitor_alerts
        SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
        WHERE id IN (
            SELECT id FROM deep_visitor_alerts
            WHERE status = 'pending'
              AND scheduled_at <= ${now.toISOString()}::timestamptz
              AND scheduled_at >= ${staleBefore.toISOString()}::timestamptz
              AND workspace_id IN ${workspaceIds}
            ORDER BY scheduled_at ASC, id ASC
            LIMIT ${DELIVERY_BATCH}
            FOR UPDATE SKIP LOCKED
        )
        RETURNING ${CLAIMED_COLUMNS}
    `)) as unknown as ClaimedRow[];
    return [...rows].sort((a, b) => a.id - b.id);
}

/**
 * 예약 시각이 24시간 넘게 지난 pending을 보내지 않고 닫고, 같은 문장에서 첫 발송 묶음을 집는다.
 *
 * 묵은 줄 닫기: live에서 off·dry_run으로 내렸다가, 또는 허용 목록에서 뺐다가 되돌렸을 때 묵은 카드가 한꺼번에
 * 나가지 않게 한다 (설계 2절). 허용 목록 밖 워크스페이스 줄은 건드리지 않는다 — 다시 넣으면 그 회차 발송 전에 여기서 닫힌다.
 * 첫 묶음 집기는 claimBatch와 같은 조건이다. 두 일이 보는 줄은 겹치지 않는다 (예약 시각 24시간 전 / 그 뒤) —
 * 그래서 한 문장(같은 스냅숏)으로 해도 닫기를 먼저 하고 집은 것과 같다.
 */
async function expireStaleAndClaim(
    now: Date,
    workspaceIds: number[]
): Promise<{ expired: number; firstBatch: ClaimedRow[] }> {
    if (workspaceIds.length === 0) return { expired: 0, firstBatch: [] };
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);
    const rows = (await db.execute(sql`
        WITH expired AS (
            UPDATE deep_visitor_alerts
            SET status = 'skipped', last_error = ${STALE_ERROR}, locked_at = NULL
            WHERE status = 'pending'
              AND scheduled_at < ${staleBefore.toISOString()}::timestamptz
              AND workspace_id IN ${workspaceIds}
            RETURNING id
        ),
        claimed AS (
            UPDATE deep_visitor_alerts
            SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
            WHERE id IN (
                SELECT id FROM deep_visitor_alerts
                WHERE status = 'pending'
                  AND scheduled_at <= ${now.toISOString()}::timestamptz
                  AND scheduled_at >= ${staleBefore.toISOString()}::timestamptz
                  AND workspace_id IN ${workspaceIds}
                ORDER BY scheduled_at ASC, id ASC
                LIMIT ${DELIVERY_BATCH}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING ${CLAIMED_COLUMNS}
        )
        SELECT (SELECT count(*)::int FROM expired) AS expired,
               (SELECT COALESCE(json_agg(claimed), '[]'::json) FROM claimed) AS claimed
    `)) as unknown as Array<{ expired: number; claimed: ClaimedRow[] }>;
    const expired = Number(rows[0]?.expired ?? 0);
    if (expired > 0) console.log(`[deep-alert] expired ${expired} stale rows`);
    const firstBatch = [...(rows[0]?.claimed ?? [])].sort((a, b) => a.id - b.id);
    return { expired, firstBatch };
}

/**
 * 보내지 않은 채 집은 줄을 되돌린다. 시도하지 않았으니 attempts도 되돌린다.
 * lastError를 주면 남긴다 (웹훅 설정 오류로 기다리는 줄).
 */
async function releaseClaimed(ids: number[], lastError?: string): Promise<void> {
    if (ids.length === 0) return;
    await db
        .update(deepVisitorAlerts)
        .set({
            status: "pending",
            lockedAt: null,
            attempts: sql`GREATEST(${deepVisitorAlerts.attempts} - 1, 0)`,
            ...(lastError !== undefined ? { lastError } : {}),
        })
        .where(and(inArray(deepVisitorAlerts.id, ids), eq(deepVisitorAlerts.status, "processing")));
}

// ============================================
// 미리보기·목록 (읽기만)
// ============================================

/**
 * 지금(또는 now 시점) 판정하면 나갈 카드 목록. 표에 쓰지 않고 보내지도 않는다.
 * 개발 DB는 덤프라 새 방문이 없다 → now를 과거로 넣어 그 시점 기준으로 시험한다.
 * 허용 목록(DEEP_ALERT_WORKSPACE_IDS)과 무관하다 — 호출부가 조직 소유를 확인한다.
 */
export async function previewDeepVisitorAlerts(opts: {
    orgId: string;
    workspaceId: number;
    now?: Date;
}): Promise<DeepAlertPreviewResult> {
    const now = opts.now ?? new Date();
    const empty: DeepAlertPreviewResult = { candidates: 0, items: [], skippedByReason: {} };

    // 미리보기는 잠금·주기 없이 관리자가 부른다 — 겹치는 호출은 하나만 돌리고 나머지는 바쁨으로 돌려준다.
    // 락 잡기 + 대상 설정 + 후보(락을 잡았을 때만)를 한 문장으로 읽고, 뒤 조회도 같은 연결로 보낸다
    const conn = await queryClient.reserve();
    // 문장이 도중에 실패하면 락을 잡았는지 알 수 없다 (세션 락은 문장이 실패해도 남는다) → 끝에 풀어 본다
    let lockState: "held" | "not_held" | "unknown" = "unknown";
    try {
        const start = await previewStart(conn, now, opts.orgId, opts.workspaceId);
        lockState = start.acquired ? "held" : "not_held";
        const ws = start.ws;
        if (!ws) return empty;
        if (!start.acquired) return { ...empty, busy: true };

        // 자기 사이트가 없으면 판정할 것이 없다 (대상 조회가 사이트도 함께 읽었다)
        if (ws.siteId === null) return empty;
        const [det] = await detectGroup(now, [{ ...ws, siteId: ws.siteId }], start.candidates, conn);
        const [alerts] = await attachMessages(now, [det], baseUrlOf(process.env), conn);
        return {
            candidates: det.candidates,
            items: alerts.map((a) => ({
                recordId: a.recordId,
                level: a.level,
                angle: a.angle,
                deepestStage: a.verdict.deepestStage,
                message: a.message,
            })),
            skippedByReason: det.skippedByReason,
        };
    } finally {
        if (lockState === "held") {
            await conn`SELECT pg_advisory_unlock(${PREVIEW_LOCK_KEY})`;
        } else if (lockState === "unknown") {
            // 원래 오류를 덮지 않게 여기서 난 오류는 로그만 남긴다
            await conn`SELECT pg_advisory_unlock(${PREVIEW_LOCK_KEY})`.catch((e: unknown) => {
                console.error(`[deep-alert] 미리보기 락 풀기 실패: ${describeDeepAlertError(e)}`);
            });
        }
        conn.release();
    }
}

/**
 * 미리보기 첫 문장: 미리보기 락 + 그 조직의 그 워크스페이스 설정 + 후보 (락을 잡았을 때만).
 * 알림 표가 없으면(마이그레이션 전) 수준 없이 다시 읽는다 — 표 없음은 문장을 읽다 나는 오류라 락을 잡기 전이다.
 */
async function previewStart(
    conn: Exec,
    now: Date,
    orgId: string,
    workspaceId: number
): Promise<{ acquired: boolean; ws: WorkspaceContext | null; candidates: CandidateRow[] }> {
    const run = async (withLevels: boolean) => {
        const [row] = await runSql<{ acquired: boolean; contexts: ContextRow[] | null; candidates: CandidateJson[] | null }>(conn, sql`
            WITH lk AS MATERIALIZED (SELECT pg_try_advisory_lock(${PREVIEW_LOCK_KEY}) AS ok),
            ctx AS MATERIALIZED (${contextsSql([workspaceId], orgId)}),
            cand AS (${candidatesSql(now, sql`(SELECT ok FROM lk)`, withLevels)})
            SELECT (SELECT ok FROM lk) AS acquired,
                   (SELECT COALESCE(json_agg(ctx), '[]'::json) FROM ctx) AS contexts,
                   (SELECT COALESCE(json_agg(cand), '[]'::json) FROM cand) AS candidates
        `);
        const ctx = row?.contexts?.[0];
        return {
            acquired: row?.acquired === true,
            ws: ctx ? toWorkspaceContext(ctx) : null,
            candidates: (row?.candidates ?? []).map(toCandidateRow),
        };
    };
    try {
        return await run(true);
    } catch (e) {
        if (!isAlertTableMissing(e)) throw e;
        return run(false);
    }
}

/** 조직의 최근 알림 줄 (메시지 포함). 표가 아직 없으면 빈 목록 */
export async function listDeepVisitorAlerts(orgId: string, limit: number): Promise<DeepVisitorAlert[]> {
    try {
        return await db
            .select()
            .from(deepVisitorAlerts)
            .where(eq(deepVisitorAlerts.orgId, orgId))
            .orderBy(desc(deepVisitorAlerts.detectedAt), desc(deepVisitorAlerts.id))
            .limit(limit);
    } catch (e) {
        if (isAlertTableMissing(e)) return [];
        throw e;
    }
}

/**
 * 로그용 오류 설명. 오류 객체를 통째로 찍지 않는다 — 실패한 쿼리 오류(DrizzleQueryError)의
 * 메시지에는 매개변수(카드 글자 = 고객 정보)가 그대로 들어 있다.
 */
export function describeDeepAlertError(e: unknown): string {
    const pg = findPgError(e);
    if (pg) return `${pg.code}: ${pg.message}`.slice(0, 300);
    if (e instanceof Error && !("query" in e)) return e.message.slice(0, 300);
    return "쿼리 실패";
}

// ============================================
// 탐지 (설계 3·4절의 입력 만들기)
// ============================================

/**
 * 같은 조직의 워크스페이스들을 함께 탐지한다 (자기 사이트가 있는 것만). 워크스페이스마다 결과를 group 순서로 돌려준다.
 *
 * 레코드마다 최근 발송 전부를 판정하고, 알림이 되는 것 중 수준이 높고 단계가 깊은 하나를 고른다.
 * 예전에는 워크스페이스마다 열 번쯤 따로 조회했다. 지금은 묶음 전체를 몇 번에 읽고 줄마다 워크스페이스(사이트)로 가른다 —
 * 조회 조건은 예전과 같다 (조직은 묶음이 같고, 사이트·워크스페이스·방문자는 줄마다 맞춰 본다):
 *   ① 후보: 최근 세션의 click_id → 클릭 → 발송 → 레코드 + 그 레코드의 알림 수준 + (intent가 없는 레코드만)
 *      그 발송의 클릭 전부와 그 click_id로 찾은 세션 (예전: 최근 세션·짝·알림 수준·발송·클릭·찾은 세션) — 부른 쪽이 읽어 넘긴다
 *      (정기 작업은 첫 문장에서, 미리보기는 락 문장에서, 그 밖에는 loadCandidateRows). 다른 묶음의 줄은 여기서 버린다
 *   ②③ 고른 방문자의 자기 사이트 세션(그 세션의 메일 클릭으로 이어진 레코드 포함)과 이벤트 — 한 문장
 *   ④ 4절(깔때기·수신거부) 재료는 그것 없이도 알림이 되는 레코드만 읽는다 (7·8단계, loadAudienceGuardsMany) — 한 문장
 * 사이트 설정(깔때기 단계·이벤트 별칭)과 메일 칸 키는 대상 조회(contextsSql)에 이미 있다.
 */
async function detectGroup(
    now: Date,
    group: SiteTarget[],
    candidateRows: readonly CandidateRow[],
    exec: Exec
): Promise<WorkspaceDetection[]> {
    if (group.length === 0) return [];
    const orgId = group[0].orgId;
    const dets: WorkspaceDetection[] = group.map((ws) => ({
        ws,
        siteId: ws.siteId,
        funnelStages: [],
        recordRows: new Map(),
        alerts: [],
        candidates: 0,
        evaluated: 0,
        skippedByReason: {},
    }));

    // ① 후보 — 이 묶음 워크스페이스의 줄만 (splitCandidateRows가 다른 워크스페이스 줄을 버린다)
    const candidates = splitCandidateRows(candidateRows, group.map((ws) => ws.id));

    // 이미 같은 수준 이상 알림이 있는 레코드는 판정하지 않는다. 나머지는 발송마다 고른 세션을 정한다
    const work = dets.map((det) => {
        const cand = candidates.get(det.ws.id)!;
        det.candidates = cand.sendIdsByRecord.size;
        const activeRecordIds: number[] = [];
        for (const recordId of cand.sendIdsByRecord.keys()) {
            const existing = cand.existingLevels.get(recordId) ?? [];
            if (!isLevelUpgrade(existing, "deep") && !isLevelUpgrade(existing, "intent")) {
                bump(det.skippedByReason, "already_alerted");
                continue;
            }
            activeRecordIds.push(recordId);
        }

        const preps: SendPrep[] = [];
        for (const recordId of activeRecordIds) {
            for (const sendId of cand.sendIdsByRecord.get(recordId) ?? []) {
                const send = cand.sendById.get(sendId);
                if (!send) continue;
                // 그 발송의 클릭 전부 (2분 안 기계 클릭 포함 — 사람인지는 사이트 행동으로 가른다)
                const clicks = cand.clicksBySend.get(send.id) ?? [];
                // found = 그 발송의 click_id들로 찾은 세션 (같은 조직의 모든 사이트 — 자매 사이트·검사기 판정에 쓴다)
                const found = uniqBy(
                    clicks.flatMap((c) => (c.clickId ? cand.sessionsByClick.get(c.clickId) ?? [] : [])),
                    (s) => s.id
                );
                // 규칙 파일과 같은 함수로 고른다 — 방문자가 어긋나지 않게
                const shape = { sentAt: send.sentAt, clicks, foundSessions: found, ownSiteId: det.siteId };
                const chosen = pickChosenSession(shape, now);
                const fallback = humanClickFallbackSession(shape, now);
                const firstClickMs = clicks.reduce<number | null>((min, c) => {
                    const t = c.clickedAt.getTime();
                    return t <= now.getTime() && (min === null || t < min) ? t : min;
                }, null);
                preps.push({
                    send,
                    recordId,
                    clicks,
                    found,
                    chosen,
                    fallback,
                    start: firstClickMs !== null ? new Date(firstClickMs) : chosen?.startedAt ?? null,
                });
            }
        }
        return { det, existingLevels: cand.existingLevels, activeRecordIds, preps };
    });

    // ②③ 고른 방문자(사람 클릭으로 다시 고를 방문자 포함)의 자기 사이트 세션·이벤트, 메일 클릭으로 이어진 레코드.
    // 이벤트는 방문자마다 그 방문자가 걸린 발송의 가장 이른 첫 클릭 1분 전부터 — 판정 범위(start ~ start+30일)보다
    // 조금 넓게 읽고 규칙이 자른다. 오래전에 클릭된 발송 하나가 모든 방문자의 조회 범위를 넓히지 않게 방문자별로 잡는다
    const visitorsBySite = new Map<number, number[]>();
    const eventRanges = new Map<string, { siteId: number; visitorId: number; fromMs: number }>();
    for (const { det, preps } of work) {
        visitorsBySite.set(
            det.siteId,
            uniq(preps.flatMap((p) => [p.chosen?.visitorId, p.fallback?.visitorId]).filter(isPresent))
        );
        for (const p of preps) {
            if (p.start === null) continue;
            const from = p.start.getTime() - EVENT_LOOKBEHIND_MS;
            for (const s of [p.chosen, p.fallback]) {
                if (!s) continue;
                const key = siteVisitorKey(det.siteId, s.visitorId);
                const cur = eventRanges.get(key);
                if (cur === undefined || from < cur.fromMs) {
                    eventRanges.set(key, { siteId: det.siteId, visitorId: s.visitorId, fromMs: from });
                }
            }
        }
    }
    const { sessions: visitorRows, events: eventRows } = await loadVisitorMaterials(
        exec,
        now,
        orgId,
        visitorsBySite,
        [...eventRanges.values()]
    );

    const needGuardByDet: Array<{ judge: ReturnType<typeof makeJudge>; needGuard: number[]; items: GuardItem[] }> = [];
    for (const { det, existingLevels, activeRecordIds, preps } of work) {
        const visitorIds = new Set(visitorsBySite.get(det.siteId) ?? []);
        const ownRows = visitorRows.filter((r) => r.siteId === det.siteId && visitorIds.has(r.visitorId));
        const sessionsByVisitor = groupBy(
            uniqBy(ownRows, (r) => r.id).map(toSessionInput),
            (s) => s.visitorId
        );
        // 기존 방문자 판정 재료: 사내 직원·시험 브라우저는 여러 레코드의 메일을 누른다 (서로 다른 레코드 수),
        // 같은 레코드가 앞선 메일로 남긴 세션은 "메일 전 방문"이 아니다 (같은 레코드 메일의 click_id)
        const clickSummary = summarizeVisitorClicks(
            ownRows.flatMap((r) =>
                r.linkClickId !== null && r.linkRecordId !== null
                    ? [{ visitorId: r.visitorId, clickId: r.linkClickId, recordId: r.linkRecordId }]
                    : []
            )
        );
        const eventsByVisitor = groupBy(
            eventRows.filter((e) => e.siteId === det.siteId),
            (e) => e.visitorId
        );

        const judge = makeJudge(now, det, preps, sessionsByVisitor, eventsByVisitor, clickSummary);

        // 7) 먼저 4절(깔때기·수신거부) 없이 판정해 알림이 될 수 있는 레코드만 고른다.
        //    "이미 깔때기 안"·수신거부는 알림을 빼기만 하므로 여기서 알림이 안 되는 레코드는 실제로도 안 된다.
        //    같은 메일 레코드 조회(워크스페이스 레코드를 jsonb로 훑음)·수신거부·record_events는 남은 레코드만 본다.
        //    이 레코드들의 건너뛴 이유는 4절 앞의 이유(machine·not_deep 등)로 센다
        const needGuard: number[] = [];
        for (const recordId of activeRecordIds) {
            const r = judge.judgeRecord(recordId, null);
            // 4절을 더해도 수준은 같거나 낮아질 뿐이다 → 여기서 올라가지 못하면(deep이 이미 있는데 deep) 읽을 필요가 없다.
            // 알림 뒤 48시간 동안 다시 오는 사람 때문에 회차마다 같은 메일 조회를 하지 않게 한다
            if (r.best !== null && isLevelUpgrade(existingLevels.get(recordId) ?? [], r.best.level)) {
                needGuard.push(recordId);
                continue;
            }
            det.evaluated += r.evaluated;
            bump(det.skippedByReason, r.best !== null ? "already_alerted" : r.rejected?.reason ?? "no_session");
        }

        // 8) 남은 레코드만 4절 재료를 읽어 다시 판정한다
        const items: GuardItem[] = needGuard.flatMap((recordId) =>
            judge.prepsOf(recordId).flatMap((p) => {
                const sessions = [p.chosen, p.fallback].filter(isPresent);
                const visitors = sessions.length ? sessions.map((s) => s.visitorId) : [null];
                return visitors.map((visitorId) => ({ recordId, visitorId, recipientEmail: p.send.recipientEmail }));
            })
        );
        needGuardByDet.push({ judge, needGuard, items });
    }

    const guardIndexes = needGuardByDet.flatMap((g, i) => (g.needGuard.length > 0 ? [i] : []));
    const guards = await loadAudienceGuardsMany(
        exec,
        orgId,
        guardIndexes.map((i) => ({ ws: dets[i].ws, siteId: dets[i].siteId, items: needGuardByDet[i].items }))
    );
    guardIndexes.forEach((detIndex, k) => {
        const det = dets[detIndex];
        const g = guards[k];
        const { judge, needGuard } = needGuardByDet[detIndex];
        det.funnelStages = g.funnelStages;
        det.recordRows = g.recordRows;
        const existingLevels = work[detIndex].existingLevels;
        for (const recordId of needGuard) {
            const r = judge.judgeRecord(recordId, g);
            det.evaluated += r.evaluated;
            if (r.best === null) {
                bump(det.skippedByReason, r.rejected?.reason ?? "no_session");
                continue;
            }
            if (!isLevelUpgrade(existingLevels.get(recordId) ?? [], r.best.level)) {
                bump(det.skippedByReason, "already_alerted");
                continue;
            }
            det.alerts.push(r.best);
        }
    });

    return dets;
}

/**
 * 한 워크스페이스의 판정 함수 (재료를 다 읽은 뒤). 레코드 하나의 발송 전부를 판정해 알림이 되는 것 중
 * 수준이 높고 단계가 깊은 하나를 고른다.
 */
function makeJudge(
    now: Date,
    det: WorkspaceDetection,
    preps: SendPrep[],
    sessionsByVisitor: Map<number, SessionInput[]>,
    eventsByVisitor: Map<number, VisitorEventRow[]>,
    clickSummary: ReturnType<typeof summarizeVisitorClicks>
) {
    const ws = det.ws;
    const siteId = det.siteId;
    const buildInput = (p: SendPrep, session: SessionInput | null, guards: AudienceGuards | null): SendJourneyInput => {
        const visitorId = session?.visitorId ?? null;
        const item: GuardItem = { recordId: p.recordId, visitorId, recipientEmail: p.send.recipientEmail };
        return {
            sendLogId: p.send.id,
            recordId: p.recordId,
            sentAt: p.send.sentAt,
            clicks: p.clicks,
            foundSessions: p.found,
            ownSiteId: siteId,
            chosenSessionId: session?.id ?? null,
            visitorSessions: visitorId !== null ? sessionsByVisitor.get(visitorId) ?? [] : [],
            visitorEvents: visitorId !== null && p.start !== null
                ? toEventInputs(eventsByVisitor.get(visitorId) ?? [], p.start)
                : [],
            // 줄이 없으면 이 레코드 하나로 본다
            distinctClickedRecordsForVisitor: visitorId !== null ? Math.max(1, clickSummary.distinctRecords(visitorId)) : 0,
            sameRecordClickIds: visitorId !== null ? clickSummary.clickIdsFor(visitorId, p.recordId) : [],
            alreadyInFunnel: guards ? guards.alreadyInFunnel(item) : false,
            unsubscribed: guards ? guards.unsubscribed(item) : false,
        };
    };

    const prepsByRecord = groupBy(preps, (p) => p.recordId);
    const judgeRecord = (recordId: number, guards: AudienceGuards | null) => {
        let best: DeepAlertCandidate | null = null;
        let rejected: { reason: string; stage: number; sentAt: number } | null = null;
        const list = prepsByRecord.get(recordId) ?? [];

        for (const p of list) {
            // 고른 세션이 기계로 판정되면 사람 클릭 세션으로 한 번 더 본다 (설계 3절, B21)
            const { input, verdict } = evaluateSendWithFallback(
                buildInput(p, p.chosen, guards),
                now,
                (alt) => buildInput(p, alt, guards)
            );
            const decision = decideAlert(input, verdict, now);

            if (decision.alert && decision.level && decision.angle) {
                const related = guards
                    ? guards.relatedOf({
                        recordId,
                        visitorId: verdict.chosenSession?.visitorId ?? null,
                        recipientEmail: p.send.recipientEmail,
                    })
                    : [];
                const candidate: DeepAlertCandidate = {
                    recordId,
                    sendLogId: p.send.id,
                    input,
                    verdict,
                    level: decision.level,
                    angle: decision.angle,
                    sentAt: p.send.sentAt,
                    otherRecordIds: related.filter(
                        (id) => id !== recordId && guards?.recordRows.get(id)?.workspaceId === ws.id
                    ),
                };
                if (best === null || isBetterCandidate(candidate, best)) best = candidate;
            } else {
                // 레코드 하나에 이유 하나만 센다 — 가장 깊이 간 발송의 이유가 실제 사정에 가깝다
                const stage = verdict.deepestStage;
                const sentAt = p.send.sentAt.getTime();
                if (rejected === null || stage > rejected.stage || (stage === rejected.stage && sentAt > rejected.sentAt)) {
                    rejected = { reason: decision.reason, stage, sentAt };
                }
            }
        }
        return { best, rejected, evaluated: list.length };
    };

    return { judgeRecord, prepsOf: (recordId: number) => prepsByRecord.get(recordId) ?? [] };
}

function isBetterCandidate(a: DeepAlertCandidate, b: DeepAlertCandidate): boolean {
    const rank = (l: DeepAlertLevel) => (l === "intent" ? 2 : 1);
    if (rank(a.level) !== rank(b.level)) return rank(a.level) > rank(b.level);
    if (a.verdict.deepestStage !== b.verdict.deepestStage) return a.verdict.deepestStage > b.verdict.deepestStage;
    return a.sentAt.getTime() > b.sentAt.getTime();
}

function toEventInputs(
    rows: {
        sessionId: number;
        eventType: string;
        eventName: string | null;
        pageUrl: string | null;
        pageTitle: string | null;
        occurredAt: Date;
        properties: unknown;
    }[],
    start: Date
): EventInput[] {
    const from = start.getTime() - EVENT_LOOKBEHIND_MS;
    return rows
        .filter((e) => e.occurredAt.getTime() >= from)
        .map((e) => ({
            sessionId: e.sessionId,
            eventType: e.eventType,
            eventName: e.eventName,
            pageUrl: e.pageUrl,
            pageTitle: e.pageTitle,
            occurredAt: e.occurredAt,
            properties: isPlainObject(e.properties) ? e.properties : null,
        }));
}

/** 탐지 대상 설정 한 줄 (contextsSql) */
interface ContextRow {
    id: number;
    org_id: string;
    name: string;
    default_field_type_id: number | null;
    site_id: number | null;
    funnels: SiteFunnel[] | null;
    aliases: SiteAlias[] | null;
    email_keys: unknown[] | null;
}

/**
 * 탐지 대상 워크스페이스와 그 사이트 설정·메일 칸 키 (조각 — 첫 문장의 ctx, loadWorkspaceContexts가 같이 쓴다).
 * 예전 조회와 같은 값이다:
 *   site_id    — 탐지의 사이트 조회 (같은 조직·활성. 워크스페이스당 사이트는 하나 — tracker_sites_workspace_unique)
 *   funnels    — 그 사이트의 퍼널 전부 (id 순). 4절 깔때기 단계(funnelFieldStagesOf)·카드 CUSTOM 라벨(eventLabelsOf)
 *   aliases    — 그 사이트의 SECTION_VIEW·CLICK·CUSTOM 별칭 (id 순). 카드 라벨 (eventLabelsOf가 예전처럼 조직을 가른다)
 *   email_keys — loadEmailFieldKeys: 워크스페이스 기본 속성 타입·파티션 속성 타입·워크스페이스 직속 칸 중 메일 칸 키
 * orgId를 주면 그 조직 워크스페이스만 (미리보기).
 */
function contextsSql(ids: number[], orgId: string | undefined): SQL {
    return sql`
        SELECT w.id, w.org_id, w.name, w.default_field_type_id, s.id AS site_id,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'id', f.id, 'orgId', f.org_id, 'kind', f.kind, 'isDefault', f.is_default,
                       'createdAt', f.created_at, 'stages', f.stages
                   ) ORDER BY f.id)
                   FROM tracker_funnels f
                   WHERE f.site_id = s.id
               ), '[]'::json) AS funnels,
               COALESCE((
                   SELECT json_agg(json_build_object(
                       'orgId', a.org_id, 'eventType', a.event_type, 'eventName', a.event_name, 'label', a.label
                   ) ORDER BY a.id)
                   FROM tracker_event_aliases a
                   WHERE a.site_id = s.id
                     AND a.event_type IN ('SECTION_VIEW', 'CLICK', 'CUSTOM')
               ), '[]'::json) AS aliases,
               COALESCE((
                   SELECT json_agg(DISTINCT fd.key)
                   FROM field_definitions fd
                   WHERE fd.field_type = 'email'
                     AND (fd.workspace_id = w.id
                          OR fd.field_type_id = w.default_field_type_id
                          OR fd.field_type_id IN (
                              SELECT p.field_type_id FROM partitions p
                              WHERE p.workspace_id = w.id AND p.field_type_id IS NOT NULL
                          ))
               ), '[]'::json) AS email_keys
        FROM workspaces w
        LEFT JOIN tracker_sites s
            ON s.workspace_id = w.id AND s.org_id = w.org_id AND s.is_active = 1
        WHERE w.id = ANY(${sql.param(ids)}::int[])
          ${orgId !== undefined ? sql`AND w.org_id = ${orgId}::uuid` : sql.empty()}
    `;
}

function toWorkspaceContext(r: ContextRow): WorkspaceContext {
    return {
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        defaultFieldTypeId: r.default_field_type_id,
        siteId: r.site_id,
        funnels: r.funnels ?? [],
        aliases: r.aliases ?? [],
        emailKeys: emailKeysOf(r.email_keys),
    };
}

/** 탐지 대상 워크스페이스와 그 사이트 설정·메일 칸 키 (워크스페이스 id 순). 첫 문장을 못 쓸 때·보내기 전 재확인에서 쓴다 */
async function loadWorkspaceContexts(exec: Exec, ids: number[], orgId?: string): Promise<WorkspaceContext[]> {
    if (ids.length === 0) return [];
    const rows = await runSql<ContextRow>(exec, sql`${contextsSql(ids, orgId)} ORDER BY w.id ASC`);
    return rows.map(toWorkspaceContext);
}

/**
 * ① 후보 (조각 — 앞에 ctx(id, org_id, site_id)가 있어야 한다. gate가 참일 때만 읽는다). 예전 조회 여섯과 같은 조건:
 *   최근 세션(사이트마다, started_at이 since~now, click_id 있음) → 그 click_id의 클릭(조직) → 발송(조직, sent, 레코드 있음)
 *   → 레코드(조직, 그 사이트의 워크스페이스)   [예전 recentSessions·pairs·sends]
 *   + 그 레코드의 알림 수준 (deep_visitor_alerts, 조직)   [예전 loadExistingLevels]
 *   + intent 알림이 없는 레코드만: 그 발송의 클릭 전부(조직) → 그 click_id로 찾은 세션(같은 조직 사이트, now까지)
 *                                                          [예전 clickRows·foundRows]
 * 줄의 조직·사이트·워크스페이스는 ctx 줄(워크스페이스와 그 활성 사이트)에서 온다 — 다른 워크스페이스 레코드로 이어진
 * 클릭은 그 사업이 따로 판정한다. 사이트가 없는 워크스페이스는 줄이 없다.
 */
function candidatesSql(now: Date, gate: SQL, withLevels = true): SQL {
    const nowIso = now.toISOString();
    const sinceIso = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const levelExists = (level: DeepAlertLevel) =>
        withLevels
            ? sql`EXISTS (SELECT 1 FROM deep_visitor_alerts a WHERE a.org_id = c.org_id AND a.record_id = r.id AND a.level = ${level})`
            : sql`false`;
    return sql`
        SELECT DISTINCT
               r.workspace_id, r.id AS record_id, l.id AS send_log_id, l.sent_at, l.recipient_email,
               ${levelExists("deep")} AS has_deep,
               ${levelExists("intent")} AS has_intent,
               c2.id AS click_log_id, c2.click_id, c2.clicked_at,
               s2.id AS s_id, s2.site_id AS s_site_id, s2.visitor_id AS s_visitor_id, s2.started_at AS s_started_at,
               s2.ended_at AS s_ended_at, s2.duration AS s_duration, s2.page_count AS s_page_count, s2.click_id AS s_click_id
        FROM ctx c
        JOIN tracker_sessions ts
            ON ts.site_id = c.site_id
           AND ts.started_at >= ${sinceIso}::timestamptz
           AND ts.started_at <= ${nowIso}::timestamptz
           AND ts.click_id IS NOT NULL
        JOIN email_click_logs cl ON cl.click_id = ts.click_id AND cl.org_id = c.org_id
        JOIN email_send_logs l
            ON l.id = cl.send_log_id AND l.org_id = c.org_id AND l.status = 'sent' AND l.record_id IS NOT NULL
        JOIN records r ON r.id = l.record_id AND r.org_id = c.org_id AND r.workspace_id = c.id
        -- 이미 intent 알림이 있는 레코드는 판정하지 않으니 클릭·세션을 읽지 않는다
        LEFT JOIN email_click_logs c2
            ON c2.send_log_id = l.id AND c2.org_id = c.org_id
           AND NOT ${levelExists("intent")}
        LEFT JOIN tracker_sessions s2
            ON s2.click_id = c2.click_id
           AND s2.started_at <= ${nowIso}::timestamptz
           AND s2.site_id IN (SELECT st.id FROM tracker_sites st WHERE st.org_id = c.org_id)
        WHERE ${gate}
    `;
}

/**
 * ① 후보를 따로 읽는다 (첫 문장 재료를 못 쓸 때 — 탐지 앞 발송이 있었거나, 하나씩 다시 탐지할 때). 묶음 = 같은 조직.
 * 알림 표가 없으면(마이그레이션 전) 수준 없이 다시 읽는다 — 예전 loadExistingLevels처럼 알림이 없는 것으로 본다.
 */
async function loadCandidateRows(exec: Exec, now: Date, group: SiteTarget[]): Promise<CandidateRow[]> {
    try {
        return await queryCandidateRows(exec, now, group, true);
    } catch (e) {
        if (!isAlertTableMissing(e)) throw e;
        return queryCandidateRows(exec, now, group, false);
    }
}

async function queryCandidateRows(exec: Exec, now: Date, group: SiteTarget[], withLevels: boolean): Promise<CandidateRow[]> {
    if (group.length === 0) return [];
    const ctx = sql`
        SELECT * FROM unnest(${sql.param(group.map((w) => w.id))}::int[], ${sql.param(group.map((w) => w.orgId))}::uuid[], ${sql.param(group.map((w) => w.siteId))}::int[])
            AS c(id, org_id, site_id)
    `;
    const [row] = await runSql<{ candidates: CandidateJson[] | null }>(exec, sql`
        WITH ctx AS MATERIALIZED (${ctx}), cand AS (${candidatesSql(now, sql`true`, withLevels)})
        SELECT COALESCE(json_agg(cand), '[]'::json) AS candidates FROM cand
    `);
    return (row?.candidates ?? []).map(toCandidateRow);
}

/** ② 방문자 세션 한 줄 + 그 세션 click_id의 메일 클릭→발송→레코드 (없으면 null) */
interface VisitorSessionRow extends SessionInput {
    linkClickId: string | null;
    linkRecordId: number | null;
}

/**
 * ②③ 고른 방문자의 세션·이벤트를 한 문장으로 읽는다 (서로 기대지 않는 두 조회).
 *   ② sessionPairs의 (사이트, 방문자)마다 그 사이트 세션(now까지, started_at·id 순)과 그 세션에 붙은 메일 클릭으로 이어진 레코드.
 *      예전 visitorSessionRows(세션)·clickLinkRows(세션 → 클릭(조직) → 발송(조직, 레코드 있음))와 같다 —
 *      click_id는 클릭 표에서 유일하고 발송은 PK로 붙으므로 세션 한 줄에 많아야 한 연결이다.
 *   ③ eventRanges의 (사이트, 방문자)마다 fromMs 이후 now까지의 이벤트 (occurred_at·id 순).
 *      tracker_events_visitor_occurred_idx(visitor_id, occurred_at)를 방문자마다 범위로 탄다.
 * (사이트, 방문자) 짝을 배열로 넘겨 짝마다 맞춰 읽는다 — 예전처럼 부른 쪽이 줄의 (사이트, 방문자)로 다시 거른다.
 * 시각 배열은 text[]로 넘겨 형을 바꾼다 — drizzle이 시각(배열 포함) 직렬화를 꺼 두어 Date 배열은 그대로 보낼 수 없다.
 */
async function loadVisitorMaterials(
    exec: Exec,
    now: Date,
    orgId: string,
    visitorsBySite: Map<number, number[]>,
    eventRanges: Array<{ siteId: number; visitorId: number; fromMs: number }>
): Promise<{ sessions: VisitorSessionRow[]; events: VisitorEventRow[] }> {
    const pairs = [...visitorsBySite.entries()].flatMap(([siteId, visitorIds]) =>
        visitorIds.map((visitorId) => ({ siteId, visitorId }))
    );
    if (pairs.length === 0 && eventRanges.length === 0) return { sessions: [], events: [] };
    const nowIso = now.toISOString();
    const [row] = await runSql<{ sessions: VisitorSessionJson[] | null; events: VisitorEventJson[] | null }>(exec, sql`
        WITH vp AS (
            SELECT * FROM unnest(${sql.param(pairs.map((p) => p.siteId))}::int[], ${sql.param(pairs.map((p) => p.visitorId))}::int[])
                AS v(site_id, visitor_id)
        ),
        vs AS (
            SELECT ts.id, ts.site_id, ts.visitor_id, ts.started_at, ts.ended_at, ts.duration, ts.page_count, ts.click_id,
                   cl.click_id AS link_click_id, l.record_id AS link_record_id
            FROM vp
            JOIN tracker_sessions ts
                ON ts.visitor_id = vp.visitor_id AND ts.site_id = vp.site_id AND ts.started_at <= ${nowIso}::timestamptz
            LEFT JOIN email_click_logs cl ON cl.click_id = ts.click_id AND cl.org_id = ${orgId}::uuid
            LEFT JOIN email_send_logs l
                ON l.id = cl.send_log_id AND l.org_id = ${orgId}::uuid AND l.record_id IS NOT NULL
        ),
        er AS (
            SELECT * FROM unnest(
                ${sql.param(eventRanges.map((r) => r.siteId))}::int[],
                ${sql.param(eventRanges.map((r) => r.visitorId))}::int[],
                ${sql.param(eventRanges.map((r) => new Date(r.fromMs).toISOString()))}::text[]::timestamptz[]
            ) AS r(site_id, visitor_id, from_at)
        ),
        ev AS (
            SELECT e.id, e.site_id, e.visitor_id, e.session_id, e.event_type, e.event_name, e.page_url, e.page_title,
                   e.occurred_at, e.properties
            FROM er
            JOIN tracker_events e
                ON e.visitor_id = er.visitor_id AND e.site_id = er.site_id
               AND e.occurred_at >= er.from_at AND e.occurred_at <= ${nowIso}::timestamptz
        )
        SELECT (SELECT COALESCE(json_agg(vs ORDER BY vs.started_at, vs.id), '[]'::json) FROM vs) AS sessions,
               (SELECT COALESCE(json_agg(ev ORDER BY ev.occurred_at, ev.id), '[]'::json) FROM ev) AS events
    `);
    return {
        sessions: (row?.sessions ?? []).map((r) => ({
            id: r.id,
            siteId: r.site_id,
            visitorId: r.visitor_id,
            startedAt: toDate(r.started_at) as Date,
            endedAt: toDate(r.ended_at),
            duration: r.duration,
            pageCount: r.page_count,
            clickId: r.click_id,
            // 발송이 안 붙으면(다른 조직·레코드 없음) 연결이 아니다
            linkClickId: r.link_record_id !== null ? r.link_click_id : null,
            linkRecordId: r.link_record_id,
        })),
        events: (row?.events ?? []).map((e) => ({
            siteId: e.site_id,
            visitorId: e.visitor_id,
            sessionId: e.session_id,
            eventType: e.event_type,
            eventName: e.event_name,
            pageUrl: e.page_url,
            pageTitle: e.page_title,
            occurredAt: toDate(e.occurred_at) as Date,
            properties: e.properties,
        })),
    };
}

interface VisitorSessionJson {
    id: number;
    site_id: number;
    visitor_id: number;
    started_at: string;
    ended_at: string | null;
    duration: number | null;
    page_count: number | null;
    click_id: string | null;
    link_click_id: string | null;
    link_record_id: number | null;
}

interface VisitorEventJson {
    site_id: number;
    visitor_id: number;
    session_id: number;
    event_type: string;
    event_name: string | null;
    page_url: string | null;
    page_title: string | null;
    occurred_at: string;
    properties: unknown;
}

function toSessionInput(r: VisitorSessionRow): SessionInput {
    return {
        id: r.id,
        siteId: r.siteId,
        visitorId: r.visitorId,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        duration: r.duration,
        pageCount: r.pageCount,
        clickId: r.clickId,
    };
}

interface VisitorEventRow {
    siteId: number;
    visitorId: number;
    sessionId: number;
    eventType: string;
    eventName: string | null;
    pageUrl: string | null;
    pageTitle: string | null;
    occurredAt: Date;
    properties: unknown;
}

/** 그 사이트의 기본 마케팅 깔때기에서 record_field 단계만 ({field, value}) — 대상 조회에 없는 사이트일 때만 읽는다 */
async function loadFunnelFieldStages(siteId: number, orgId: string): Promise<FunnelFieldStage[]> {
    const [funnel] = await db
        .select({ stages: trackerFunnels.stages })
        .from(trackerFunnels)
        .where(and(
            eq(trackerFunnels.siteId, siteId),
            eq(trackerFunnels.orgId, orgId),
            eq(trackerFunnels.kind, "marketing"),
            eq(trackerFunnels.isDefault, 1),
        ))
        .orderBy(desc(trackerFunnels.createdAt))
        .limit(1);
    const out: FunnelFieldStage[] = [];
    for (const st of funnel?.stages ?? []) {
        if (st.match?.type === "record_field" && st.match.field && st.match.value) {
            out.push({ field: st.match.field, value: st.match.value });
        }
    }
    return out;
}

/** 4절 재료를 읽을 묶음 하나: 워크스페이스(설정 포함)·사이트·판정 항목 */
interface GuardGroup {
    ws: WorkspaceContext;
    siteId: number | null;
    items: GuardItem[];
}

interface GuardRecordJson {
    id: number;
    workspace_id: number;
    partition_id: number;
    integrated_code: string | null;
    created_at: string;
    data: Record<string, unknown> | null;
    email_match: boolean | null;
}

/**
 * 받는 메일 주소가 같은 레코드 조건 (조각). normalizeEmail과 같은 규칙으로 비교한다 —
 * 앞뒤 문자는 EMAIL_TRIM_CHARS로 btrim한다 (Postgres trim()은 공백만 지워 JS와 어긋났다).
 * 예전 조건(워크스페이스마다 workspace_id = w AND (칸 키마다 lower(btrim(data->>key)) IN 그 워크스페이스 주소))과 같다:
 * 칸 키마다 (워크스페이스, 주소) 짝을 배열로 넘겨 (r.workspace_id, 값) IN 짝 — 워크스페이스를 한 번만 훑는다.
 */
function sameEmailSql(specs: Array<{ workspaceId: number; keys: string[]; emails: string[] }>): SQL {
    const parts = [...emailPairsByKey(specs)].map(([key, p]) => sql`
        (r.workspace_id, lower(btrim(r.data->>${key}::text, ${EMAIL_TRIM_CHARS}::text))) IN (
            SELECT * FROM unnest(${sql.param(p.ws)}::int[], ${sql.param(p.emails)}::text[])
        )`);
    return parts.length === 0 ? sql`false` : sql.join(parts, sql` OR `);
}

/**
 * 설계 4절 "이미 깔때기 안"·수신거부 재료를 묶어 읽는다. 탐지와 보내기 전 재확인이 같이 쓴다 — 규칙이 어긋나지 않게.
 * 같은 조직의 여러 묶음(워크스페이스·사이트)을 함께 읽고 묶음마다 결과를 groups 순서로 돌려준다.
 *
 * 깔때기 안 = 레코드 자신·그 방문자에 이어진 레코드·같은 워크스페이스에서 받는 메일이 같은 레코드 중 하나라도
 * isRecordInFunnel. 수신거부 = buildUnsubscribeIndex/isUnsubscribedBy.
 * 조회는 한 문장이다 (예전: 이어진 레코드·수신거부 → 레코드 → 깔때기 이벤트 세 번). 문장 안에서 앞 결과를 이어 쓴다:
 *   linked   방문자 → 이어진 레코드 (대표 tracker_visitors.record_id 먼저, visitor_record_links는 줄 id 순 — relatedOf 순서가 예전과 같게)
 *   unsub    수신거부 줄: record_id가 같은 줄과 (같은 워크스페이스에서 메일이 같은) 줄. 묶음마다 찾아보기 표가 그 묶음의
 *            레코드 id·메일로만 찾으므로 다른 묶음 때문에 더 읽힌 줄은 답을 바꾸지 않는다
 *   grec     레코드: 대상·이어진 레코드(조직) ∪ 받는 메일 주소가 같은 레코드(조직·그 워크스페이스). email_match = 메일 조건으로 찾은 줄
 *   fev      record_events 중 깔때기 도달 후보 (type='signup' 또는 label이 단계 값 중 하나) — grec 레코드 전부에서 읽고,
 *            묶음마다 그 묶음의 관련 레코드·단계 값으로 거른다 (예전 묶음별 조회 + isFunnelRecordEvent와 같다). 단계 값이 없으면 읽지 않는다
 * 사이트 설정·메일 칸 키는 워크스페이스 설정(contextsSql)에서 꺼낸다 — 사이트가 지금 활성 사이트와 다를 때만 깔때기를 따로 읽는다.
 */
async function loadAudienceGuardsMany(exec: Exec, orgId: string, groups: GuardGroup[]): Promise<AudienceGuards[]> {
    if (groups.length === 0) return [];

    const emailsOf = groups.map((g) =>
        uniq(g.items.map((i) => normalizeEmail(i.recipientEmail)).filter((e) => e !== ""))
    );
    const emailsByWorkspace = new Map<number, string[]>();
    groups.forEach((g, i) => {
        emailsByWorkspace.set(g.ws.id, uniq([...(emailsByWorkspace.get(g.ws.id) ?? []), ...emailsOf[i]]));
    });
    const funnelStagesOf = await Promise.all(
        groups.map((g) =>
            g.siteId === null
                ? Promise.resolve([] as FunnelFieldStage[])
                : g.siteId === g.ws.siteId
                    ? Promise.resolve(funnelFieldStagesOf(g.ws.funnels, orgId))
                    : loadFunnelFieldStages(g.siteId, orgId)
        )
    );

    // 가입 레코드는 메일 방문자와 이어지지 않는 경우가 많다 (gaps 14) → 같은 메일 주소로도 찾는다
    const specs = [...emailsByWorkspace.entries()].map(([workspaceId, emails]) => ({
        workspaceId,
        keys: emails.length > 0 ? groups.find((g) => g.ws.id === workspaceId)!.ws.emailKeys : [],
        emails,
    }));
    const visitorIds = uniq(groups.flatMap((g) => g.items.map((i) => i.visitorId).filter(isPresent)));
    const itemRecordIds = uniq(groups.flatMap((g) => g.items.map((i) => i.recordId)));
    const unsubWorkspaceIds = specs.filter((s) => s.emails.length > 0).map((s) => s.workspaceId);
    const allEmails = uniq(specs.flatMap((s) => s.emails));
    const allStageValues = uniq(funnelStagesOf.flatMap((stages) => stages.map((s) => s.value)));
    const emailMatch = sameEmailSql(specs);

    const [row] = await runSql<{
        linked: Array<{ visitor_id: number; record_id: number | null }> | null;
        unsub: Array<{ record_id: number | null; workspace_id: number | null; email: string | null }> | null;
        records: GuardRecordJson[] | null;
        funnel_events: Array<{ record_id: number; type: string | null; label: string | null }> | null;
    }>(exec, sql`
        WITH linked AS MATERIALIZED (
            SELECT v.id AS visitor_id, v.record_id, 0 AS src, 0 AS ord
            FROM tracker_visitors v
            WHERE v.id = ANY(${sql.param(visitorIds)}::int[]) AND v.org_id = ${orgId}::uuid AND v.record_id IS NOT NULL
            UNION ALL
            SELECT l.visitor_id, l.record_id, 1 AS src, l.id AS ord
            FROM visitor_record_links l
            WHERE l.visitor_id = ANY(${sql.param(visitorIds)}::int[]) AND l.org_id = ${orgId}::uuid
        ),
        unsub AS (
            SELECT u.record_id, u.workspace_id, u.email
            FROM email_unsubscribes u
            WHERE u.org_id = ${orgId}::uuid
              AND (u.record_id = ANY(${sql.param(itemRecordIds)}::int[])
                   OR (u.workspace_id = ANY(${sql.param(unsubWorkspaceIds)}::int[])
                       AND lower(btrim(u.email, ${EMAIL_TRIM_CHARS}::text)) = ANY(${sql.param(allEmails)}::text[])))
        ),
        grec AS MATERIALIZED (
            SELECT r.id, r.workspace_id, r.partition_id, r.integrated_code, r.created_at, r.data,
                   (${emailMatch}) AS email_match
            FROM records r
            WHERE r.org_id = ${orgId}::uuid
              AND (r.id = ANY(${sql.param(itemRecordIds)}::int[])
                   OR r.id IN (SELECT record_id FROM linked)
                   OR (${emailMatch}))
        ),
        fev AS (
            SELECT DISTINCT e.record_id, e.type, e.label
            FROM record_events e
            WHERE cardinality(${sql.param(allStageValues)}::text[]) > 0
              AND e.org_id = ${orgId}::uuid
              AND e.record_id IN (SELECT id FROM grec)
              AND (e.type = 'signup' OR e.label = ANY(${sql.param(allStageValues)}::text[]))
        )
        SELECT (SELECT COALESCE(json_agg(json_build_object('visitor_id', visitor_id, 'record_id', record_id) ORDER BY src, ord), '[]'::json) FROM linked) AS linked,
               (SELECT COALESCE(json_agg(unsub), '[]'::json) FROM unsub) AS unsub,
               (SELECT COALESCE(json_agg(grec ORDER BY grec.id), '[]'::json) FROM grec) AS records,
               (SELECT COALESCE(json_agg(fev), '[]'::json) FROM fev) AS funnel_events
    `);

    const linkedByVisitor = new Map<number, Set<number>>();
    for (const r of row?.linked ?? []) {
        if (r.record_id === null) continue;
        const set = linkedByVisitor.get(r.visitor_id) ?? new Set<number>();
        set.add(r.record_id);
        linkedByVisitor.set(r.visitor_id, set);
    }
    const unsubRows: UnsubscribeRow[] = (row?.unsub ?? []).map((u) => ({
        recordId: u.record_id,
        workspaceId: u.workspace_id,
        email: u.email,
    }));
    const guardRecords = (row?.records ?? []).map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        partitionId: r.partition_id,
        integratedCode: r.integrated_code,
        createdAt: toDate(r.created_at) as Date,
        data: isPlainObject(r.data) ? r.data : {},
        emailMatch: r.email_match === true,
    }));
    const funnelEventRows = (row?.funnel_events ?? []).map((e) => ({ recordId: e.record_id, type: e.type, label: e.label }));

    const recordRows = new Map<number, RecordRow>();
    for (const r of guardRecords) {
        if (!recordRows.has(r.id)) recordRows.set(r.id, r);
    }

    return groups.map((g, i) => {
        const emailSet = new Set(emailsOf[i]);
        const emailKeys = emailsOf[i].length > 0 ? g.ws.emailKeys : [];
        const recordsByEmail = new Map<string, Set<number>>();
        for (const r of guardRecords) {
            if (!r.emailMatch || r.workspaceId !== g.ws.id) continue;
            for (const key of emailKeys) {
                const value = r.data[key];
                if (typeof value !== "string") continue;
                const e = normalizeEmail(value);
                if (!emailSet.has(e)) continue;
                const set = recordsByEmail.get(e) ?? new Set<number>();
                set.add(r.id);
                recordsByEmail.set(e, set);
            }
        }
        const relatedOf = (item: GuardItem): number[] => {
            const ids = new Set<number>([item.recordId]);
            if (item.visitorId !== null) for (const id of linkedByVisitor.get(item.visitorId) ?? []) ids.add(id);
            for (const id of recordsByEmail.get(normalizeEmail(item.recipientEmail)) ?? []) ids.add(id);
            // 조직 확인을 거친 레코드만 쓴다 (링크 표에는 조직 FK가 없다)
            return [...ids].filter((id) => recordRows.has(id));
        };
        const stageValues = uniq(funnelStagesOf[i].map((s) => s.value));
        const relatedSet = new Set(stageValues.length > 0 ? g.items.flatMap(relatedOf) : []);
        // 이 묶음의 레코드·단계 값으로만 거른다 (예전 묶음별 조회 + isFunnelRecordEvent와 같다)
        const funnelEventRecordIds = new Set(
            funnelEventRows
                .filter((r) => relatedSet.has(r.recordId) && isFunnelRecordEvent(r, stageValues))
                .map((r) => r.recordId)
        );
        const unsub = buildUnsubscribeIndex(unsubRows, g.ws.id);
        const funnelStages = funnelStagesOf[i];
        const inFunnel = (recordId: number): boolean =>
            isRecordInFunnel(funnelStages, recordRows.get(recordId)?.data, funnelEventRecordIds.has(recordId));
        return {
            funnelStages,
            recordRows,
            relatedOf,
            alreadyInFunnel: (item) => relatedOf(item).some(inFunnel),
            unsubscribed: (item) => isUnsubscribedBy(unsub, item.recordId, item.recipientEmail),
        };
    });
}

// ============================================
// 근거 모으기 (설계 5절 카드 재료)
// ============================================

interface EmailEvidenceRow {
    id: number;
    record_id: number;
    sent_at: string | Date;
    subject: string | null;
    trigger_type: string | null;
    rule_name: string | null;
    /** 그 메일의 클릭 시각들 (clicked_at 순, JSON 문자열) */
    clicked_at_list: string[] | null;
}

interface PartitionRow {
    id: number;
    name: string;
    fieldTypeId: number | null;
}

/**
 * 알림 후보의 CRM 근거를 모아 카드 글자를 만든다. 같은 조직 워크스페이스들의 알림을 함께 처리하고
 * 워크스페이스마다 결과를 dets 순서로 돌려준다 (알림이 없는 워크스페이스는 빈 목록).
 * email_send_logs에는 record_id 인덱스가 없다 → 후보를 다 거른 뒤 여기서 한 번에 조회한다.
 * 근거 조회는 한 문장이다 (예전: 파티션·받은 메일과 그 클릭·상태 이력·메모·알림톡·칸 정의 여섯 번). 문장 안의 각 부분은
 * 예전 조회와 같은 조건·같은 순서다. 칸 정의는 카드가 쓸 수 있는 속성 타입(파티션·워크스페이스 기본)과 워크스페이스
 * 직속 칸을 함께 읽고, 카드마다 예전 해석(파티션 → 워크스페이스 기본 → 직속)으로 고른다 (resolveFieldDefs).
 * 이벤트 라벨은 워크스페이스 설정(contextsSql)으로 만든다 (예전 loadEventLabels와 같은 값).
 */
async function attachMessages(
    now: Date,
    dets: WorkspaceDetection[],
    baseUrl: string,
    exec: Exec
): Promise<DetectedAlert[][]> {
    const result: DetectedAlert[][] = dets.map(() => []);
    const withAlerts = dets.filter((d) => d.alerts.length > 0);
    if (withAlerts.length === 0) return result;
    const orgId = withAlerts[0].ws.orgId;
    const alertIds = uniq(withAlerts.flatMap((d) => d.alerts.map((a) => a.recordId)));

    // 파티션 (알림 레코드 + 다른 레코드). 워크스페이스는 줄마다 맞춰 본다
    const partitionIds = uniq(
        withAlerts.flatMap((det) =>
            det.alerts
                .flatMap((a) => [a.recordId, ...a.otherRecordIds])
                .map((id) => det.recordRows.get(id)?.partitionId)
                .filter(isPresent)
        )
    );
    const wsIds = withAlerts.map((d) => d.ws.id);
    // 칸 정의 후보: 워크스페이스 기본 속성 타입, 그리고 기본 타입이 없는 워크스페이스의 직속 칸 (파티션 타입은 문장 안에서 더한다)
    const wsDefaultTypeIds = uniq(withAlerts.map((d) => d.ws.defaultFieldTypeId).filter(isPresent));
    const directWsIds = withAlerts.filter((d) => d.ws.defaultFieldTypeId === null).map((d) => d.ws.id);

    const [row] = await runSql<{
        partitions: Array<{ id: number; name: string; field_type_id: number | null; workspace_id: number }> | null;
        emails: EmailEvidenceRow[] | null;
        events: Array<{ record_id: number; occurred_at: string; type: string; label: string | null }> | null;
        memos: Array<{ record_id: number; created_at: string; content: string; author: string | null }> | null;
        alimtalk: Array<{ record_id: number; n: number }> | null;
        fields: FieldDefJson[] | null;
    }>(exec, sql`
        WITH parts AS MATERIALIZED (
            SELECT p.id, p.name, p.field_type_id, p.workspace_id
            FROM partitions p
            WHERE p.id = ANY(${sql.param(partitionIds)}::int[]) AND p.workspace_id = ANY(${sql.param(wsIds)}::int[])
        ),
        -- 받은 메일 전부 + 규칙 이름 + 그 메일의 클릭 시각. ai_followup 로그에는 규칙 id가 없어 후속 큐로 되짚는다 (crm 지도 3절)
        mails AS (
            SELECT l.id, l.record_id, l.sent_at, l.subject, l.trigger_type,
                   COALESCE(apl.name, apl_q.name, etl.name) AS rule_name,
                   COALESCE((
                       SELECT json_agg(c.clicked_at ORDER BY c.clicked_at ASC)
                       FROM email_click_logs c
                       WHERE c.send_log_id = l.id AND c.org_id = ${orgId}::uuid
                   ), '[]'::json) AS clicked_at_list
            FROM email_send_logs l
            LEFT JOIN email_auto_personalized_links apl
                ON apl.id = l.auto_personalized_link_id AND apl.org_id = l.org_id
            LEFT JOIN LATERAL (
                SELECT q.source_id FROM email_followup_queue q
                WHERE q.parent_log_id = l.parent_log_id AND q.source_type = 'ai' AND q.org_id = l.org_id
                ORDER BY q.step_index ASC
                LIMIT 1
            ) qa ON l.trigger_type = 'ai_followup'
            LEFT JOIN email_auto_personalized_links apl_q
                ON apl_q.id = qa.source_id AND apl_q.org_id = l.org_id
            LEFT JOIN email_template_links etl ON etl.id = l.template_link_id
            WHERE l.org_id = ${orgId}::uuid
              AND l.record_id = ANY(${sql.param(alertIds)}::int[])
              AND l.status = 'sent'
        ),
        -- 상태 이력·메모(memos에는 org_id가 없다 — 레코드 id가 이미 조직 확인을 거쳤다)·알림톡
        evs AS (
            SELECT e.id, e.record_id, e.occurred_at, e.type, e.label
            FROM record_events e
            WHERE e.org_id = ${orgId}::uuid AND e.record_id = ANY(${sql.param(alertIds)}::int[])
        ),
        mm AS (
            SELECT m.id, m.record_id, m.created_at, m.content, u.name AS author
            FROM memos m
            LEFT JOIN users u ON m.created_by = u.id
            WHERE m.record_id = ANY(${sql.param(alertIds)}::int[])
        ),
        -- 카드는 "n건 보냄"이다 — 실패·대기 건은 세지 않는다 (메일 근거도 status='sent'만 쓴다)
        alim AS (
            SELECT a.record_id, count(*)::int AS n
            FROM alimtalk_send_logs a
            WHERE a.org_id = ${orgId}::uuid AND a.record_id = ANY(${sql.param(alertIds)}::int[]) AND a.status = 'sent'
            GROUP BY a.record_id
        ),
        fd AS (
            SELECT f.id, f.sort_order, f.key, f.label, f.field_type, f.field_type_id, f.workspace_id
            FROM field_definitions f
            WHERE f.field_type_id IN (SELECT field_type_id FROM parts WHERE field_type_id IS NOT NULL)
               OR f.field_type_id = ANY(${sql.param(wsDefaultTypeIds)}::int[])
               OR f.workspace_id = ANY(${sql.param(directWsIds)}::int[])
        )
        SELECT (SELECT COALESCE(json_agg(parts), '[]'::json) FROM parts) AS partitions,
               (SELECT COALESCE(json_agg(mails ORDER BY mails.sent_at ASC, mails.id ASC), '[]'::json) FROM mails) AS emails,
               (SELECT COALESCE(json_agg(evs ORDER BY evs.occurred_at DESC, evs.id DESC), '[]'::json) FROM evs) AS events,
               (SELECT COALESCE(json_agg(mm ORDER BY mm.created_at DESC, mm.id DESC), '[]'::json) FROM mm) AS memos,
               (SELECT COALESCE(json_agg(alim), '[]'::json) FROM alim) AS alimtalk,
               (SELECT COALESCE(json_agg(json_build_object(
                    'key', fd.key, 'label', fd.label, 'field_type', fd.field_type,
                    'field_type_id', fd.field_type_id, 'workspace_id', fd.workspace_id
                ) ORDER BY fd.sort_order ASC, fd.id ASC), '[]'::json) FROM fd) AS fields
    `);
    const partitionRows = row?.partitions ?? [];
    const emailRows = row?.emails ?? [];
    const eventRows = (row?.events ?? []).map((e) => ({
        recordId: e.record_id,
        occurredAt: toDate(e.occurred_at) as Date,
        type: e.type,
        label: e.label,
    }));
    const memoRows = (row?.memos ?? []).map((m) => ({
        recordId: m.record_id,
        createdAt: toDate(m.created_at) as Date,
        content: m.content,
        author: m.author,
    }));
    const alimtalkRows = row?.alimtalk ?? [];
    const fieldRows = row?.fields ?? [];

    const partitionsByWs = new Map<number, Map<number, PartitionRow>>();
    for (const p of partitionRows) {
        const byId = partitionsByWs.get(p.workspace_id) ?? new Map<number, PartitionRow>();
        byId.set(p.id, { id: p.id, name: p.name, fieldTypeId: p.field_type_id });
        partitionsByWs.set(p.workspace_id, byId);
    }
    const clicksByEmail = new Map<number, { clickedAt: Date }[]>(
        emailRows.map((r) => [
            r.id,
            (r.clicked_at_list ?? []).map((t) => toDate(t)).filter(isPresent).map((clickedAt) => ({ clickedAt })),
        ])
    );
    const emailsByRecord = groupBy(emailRows, (r) => r.record_id);
    const eventsByRecord = groupBy(eventRows, (e) => e.recordId);
    const memosByRecord = groupBy(memoRows, (m) => m.recordId);
    const alimtalkByRecord = new Map(alimtalkRows.map((r) => [r.record_id, r.n]));
    const labelsByWs = new Map(withAlerts.map((d) => [d.ws.id, eventLabelsOf(d.ws.aliases, d.ws.funnels, orgId)]));
    const fieldCache = new Map<string, FieldDefRow[]>();
    // 카드마다 같은 값을 다시 만들지 않는다 — 기한 글자는 (각도, now)만, 칸 라벨은 칸 정의 목록만 보고 정해진다
    const deadlineByAngle = new Map<DeepAlertAngle, ReturnType<typeof deadlineText>>();
    const labelsByDefs = new Map<FieldDefRow[], Record<string, string>>();

    for (const { det, alert, index } of dets.flatMap((det, index) => det.alerts.map((alert) => ({ det, alert, index })))) {
        const { ws } = det;
        const partitionById = partitionsByWs.get(ws.id) ?? new Map<number, PartitionRow>();
        const labels = labelsByWs.get(ws.id) ?? {};
        const row = det.recordRows.get(alert.recordId);
        if (!row) continue;
        const partition = partitionById.get(row.partitionId) ?? null;
        const fieldDefs = resolveFieldDefs(ws, partition, fieldRows, fieldCache);

        const recordEmails = emailsByRecord.get(alert.recordId) ?? [];
        const emails: AlertEmailEvidence[] = recordEmails.map((e) => {
            const sentAt = toDate(e.sent_at);
            const humanAfter = sentAt ? sentAt.getTime() + HUMAN_CLICK_AFTER_MS : Number.POSITIVE_INFINITY;
            return {
                sentAt,
                subject: e.subject,
                ruleName: e.rule_name,
                triggerType: e.trigger_type,
                clicks: (clicksByEmail.get(e.id) ?? []).map((c) => ({
                    clickedAt: c.clickedAt,
                    human: c.clickedAt.getTime() > humanAfter,
                })),
                isAlertSend: e.id === alert.sendLogId,
            };
        });
        const alertIndex = recordEmails.findIndex((e) => e.id === alert.sendLogId);
        const alertEmail = alertIndex >= 0 ? recordEmails[alertIndex] : null;

        const evidence: AlertEvidence = {
            businessName: ws.name,
            recordId: alert.recordId,
            integratedCode: row.integratedCode,
            partitionName: partition?.name ?? null,
            listType: listTypeOf(partition?.name ?? null),
            baseUrl,
            level: alert.level,
            angle: alert.angle,
            deadline: getOrSet(deadlineByAngle, alert.angle, () => deadlineText(alert.angle, now)),
            verdict: alert.verdict,
            alertSend: {
                sentAt: alert.sentAt,
                subject: alertEmail?.subject ?? null,
                nth: alertIndex >= 0 ? alertIndex + 1 : recordEmails.length,
                totalSends: recordEmails.length,
            },
            fields: buildFields(fieldDefs, row.data),
            // 상태 이력의 칸 키(callStatus)를 라벨(콜 상태)로 보이려고 — 이미 읽은 칸 정의에서 만든다 (쿼리 없음)
            fieldLabels: getOrSet(labelsByDefs, fieldDefs, () => fieldLabelsOf(fieldDefs)),
            companyResearch: companyResearchOf(row.data),
            emails,
            labels,
            clickTexts: clickTextsOf(alert.input.visitorEvents),
            // 상태 이력·메모는 자르지 않고 넘긴다 — 카드가 최근 8개·3개를 고르고 "(최근 N)" 머리를 붙인다
            statusHistory: (eventsByRecord.get(alert.recordId) ?? [])
                .map((e) => ({ occurredAt: e.occurredAt, type: e.type, label: e.label })),
            memos: (memosByRecord.get(alert.recordId) ?? [])
                .map((m) => ({ createdAt: m.createdAt, author: m.author, content: m.content })),
            otherRecords: alert.otherRecordIds
                .map((id) => det.recordRows.get(id))
                .filter(isPresent)
                .map((r) => ({
                    partitionName: partitionById.get(r.partitionId)?.name ?? null,
                    integratedCode: r.integratedCode,
                    createdAt: r.createdAt,
                    stage: funnelStageValueOf(det.funnelStages, r.data),
                })),
            alimtalkCount: alimtalkByRecord.get(alert.recordId) ?? 0,
        };

        result[index].push({ ...alert, message: buildAlertMessage(evidence, now) });
    }
    return result;
}

/**
 * 칸 정의 순서대로. 빈 값·_로 시작하는 키(회사 조사 등 내부 값)·파일 칸은 뺀다.
 * key·fieldType도 넘긴다 — 카드가 메일·전화·이름·회사 칸을 골라 둘째 줄 연락 요약에 올린다 (contactKindOf)
 */
function buildFields(defs: FieldDefRow[], data: Record<string, unknown>): AlertEvidence["fields"] {
    const out: AlertEvidence["fields"] = [];
    const seen = new Set<string>();
    for (const def of defs) {
        if (seen.has(def.key)) continue;
        seen.add(def.key);
        if (def.key.startsWith("_") || def.fieldType === "file") continue;
        const value = formatFieldValue(data[def.key]);
        if (value === null) continue;
        out.push({ label: def.label, value, key: def.key, fieldType: def.fieldType });
    }
    return out;
}

/** 칸 키 → 라벨 (같은 키가 두 번이면 앞의 것, buildFields와 같다) */
function fieldLabelsOf(defs: FieldDefRow[]): Record<string, string> {
    const out = new Map<string, string>();
    for (const def of defs) if (!out.has(def.key) && def.label.trim()) out.set(def.key, def.label.trim());
    return Object.fromEntries(out);
}

function formatFieldValue(value: unknown): string | null {
    let text: string;
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
        text = value.trim();
    } else if (typeof value === "number" || typeof value === "bigint") {
        text = String(value);
    } else if (typeof value === "boolean") {
        text = value ? "예" : "아니오";
    } else if (Array.isArray(value)) {
        const primitives = value.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v));
        text = primitives
            ? value.filter((v) => v !== null && String(v).trim() !== "").map((v) => String(v).trim()).join(", ")
            : JSON.stringify(value);
    } else if (typeof value === "object") {
        if (Object.keys(value).length === 0) return null;
        text = JSON.stringify(value);
    } else {
        return null;
    }
    if (text === "" || text === "[]") return null;
    return text.length > FIELD_VALUE_MAX ? text.slice(0, FIELD_VALUE_MAX - 1) + "…" : text;
}

function companyResearchOf(data: Record<string, unknown>): AlertEvidence["companyResearch"] {
    const raw = data._companyResearch;
    if (!isPlainObject(raw)) return null;
    const str = (v: unknown): string | null => {
        if (typeof v === "string") return v.trim() || null;
        if (typeof v === "number") return String(v);
        return null;
    };
    const research = {
        industry: str(raw.industry),
        employees: str(raw.employees),
        website: str(raw.website),
        description: str(raw.description),
    };
    return Object.values(research).some((v) => v !== null) ? research : null;
}

/** 다른 레코드에 붙일 깔때기 칸 값 (예: match_stage = 신청완료) */
function funnelStageValueOf(stages: FunnelFieldStage[], data: Record<string, unknown>): string | null {
    for (const field of uniq(stages.map((s) => s.field))) {
        const v = data[field];
        if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
}

/** CLICK 이벤트의 버튼 글자 (properties.text). 이름마다 처음 본 글자 */
function clickTextsOf(events: EventInput[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of events) {
        if (e.eventType !== "CLICK" || !e.eventName || out[e.eventName]) continue;
        const text = e.properties?.text;
        if (typeof text === "string" && text.trim()) out[e.eventName] = text.trim();
    }
    return out;
}

// ============================================
// 작은 도우미
// ============================================

function baseUrlOf(env: Record<string, string | undefined>): string {
    return (env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr").replace(/\/+$/, "");
}

/** db.execute 결과의 시각은 문자열로 온다 (drizzle이 postgres-js 날짜 파서를 꺼 둔다) */
function toDate(value: string | Date | null): Date | null {
    if (value === null) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function isPresent<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniq<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function uniqBy<T, K>(values: T[], key: (v: T) => K): T[] {
    const seen = new Set<K>();
    return values.filter((v) => {
        const k = key(v);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function groupBy<T, K>(values: T[], key: (v: T) => K): Map<K, T[]> {
    const out = new Map<K, T[]>();
    for (const v of values) {
        const k = key(v);
        const list = out.get(k);
        if (list) list.push(v);
        else out.set(k, [v]);
    }
    return out;
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
    if (map.has(key)) return map.get(key) as V;
    const value = make();
    map.set(key, value);
    return value;
}

function bump(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
    for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

/** drizzle이 감싼 오류(DrizzleQueryError.cause)까지 내려가 Postgres 오류를 찾는다 */
function findPgError(e: unknown): { code: string; message: string } | null {
    let cur: unknown = e;
    for (let depth = 0; depth < 4 && cur; depth++) {
        if (typeof cur === "object" && cur !== null && typeof (cur as { code?: unknown }).code === "string") {
            const message = (cur as { message?: unknown }).message;
            return { code: (cur as { code: string }).code, message: typeof message === "string" ? message : "" };
        }
        cur = (cur as { cause?: unknown }).cause;
    }
    return null;
}

/** 42P01 = 표 없음. 다른 표가 없을 때까지 삼키지 않도록 이름도 본다 */
function isAlertTableMissing(e: unknown): boolean {
    const pg = findPgError(e);
    return pg !== null && pg.code === "42P01" && pg.message.includes("deep_visitor_alerts");
}
