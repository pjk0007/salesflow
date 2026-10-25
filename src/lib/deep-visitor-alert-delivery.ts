/**
 * 깊이 들어온 사람 알림 — 집은 줄을 한 통씩 보내는 순서. DB를 모른다.
 *
 * 워커(deep-visitor-alert.ts)가 DB 쓰기·웹훅 보내기를 deps로 넘긴다. 순서와 실패 처리만 여기 두어
 * DB 없이 시험한다 (예외가 나도 집은 줄이 15분 묶이지 않는지, 웹훅 설정 오류에서 알림을 잃지 않는지).
 *
 * 설계: docs/2026-10-02-deep-visitor-alert/DESIGN.md 7절 6단계.
 */

import type { GoogleChatResult } from "@/lib/google-chat";
import { MAX_ATTEMPTS, RETRY_DELAY_MS } from "@/lib/deep-visitor-alert-rules";

/** 수신 웹훅은 스페이스당 초당 한 통 꼴만 받는다 — 몰아 보내면 429가 난다 */
export const POST_INTERVAL_MS = 1100;
export const NO_WEBHOOK_ERROR = "웹훅 주소 없음";
/** 웹훅이 없거나 형식이 틀린 워크스페이스 줄은 닫지 않고 기다린다 — 넣으면 다음 회차에 나가고, 24시간 지나면 묵은 줄로 닫힌다 (DV-15·RC-4) */
export const NO_WEBHOOK_WAIT = "웹훅 주소가 없어 넣을 때까지 기다림";
/**
 * 응답 시간 초과(구글이 이미 올렸을 수 있음)는 이만큼까지만 시도한다 — 같은 카드가 회차마다 쌓이지 않게 (CT-1).
 * 고정 messageId를 켜면(GOOGLE_CHAT_REQUEST_ID=on) 구글이 같은 ID를 한 번만 올리니 보통 시도 수(MAX_ATTEMPTS)를 쓴다
 */
export const UNCERTAIN_MAX_ATTEMPTS = 2;
export const UNCERTAIN_GIVE_UP_NOTE = "두 번 모두 응답이 없어 그만 보냄 (스페이스에 올라갔는지 확인해 주세요)";
/** 'sent' 기록이 일시 DB 오류로 실패하면 짧게 다시 해 본다 — 이미 올라간 카드가 15분 뒤 다시 나가지 않게 */
export const MARK_SENT_TRIES = 3;
export const MARK_SENT_RETRY_MS = 300;

/** 집은 줄 (attempts는 집을 때 올린 뒤의 값) */
export interface ClaimedAlert {
    id: number;
    workspaceId: number;
    /** 회신 알림의 못 이은 회신(6-3 사업 추정)은 레코드가 없다 */
    recordId: number | null;
    message: string;
    attempts: number;
}

export interface DeliveryDeps {
    now: Date;
    overBudget: () => boolean;
    webhookFor: (workspaceId: number) => string | undefined;
    /** row를 받으면 스레드 키·고정 messageId를 붙일 수 있다 */
    post: (webhookUrl: string, text: string, row?: ClaimedAlert) => Promise<GoogleChatResult>;
    /** 보낼 때 글을 고친다 (기한 줄을 보내는 때 기준으로 다시 쓰기 — DV-5·RC-12). 없으면 저장한 글 그대로 */
    prepareText?: (row: ClaimedAlert) => string;
    /** 보낸 결과를 받는 곳 상태로 남긴다 (웹훅 문제 알림, WPN-1). 던져도 보내기는 이어진다 */
    onResult?: (row: ClaimedAlert, result: GoogleChatResult) => Promise<void>;
    /** 다시 보낼 때 (기본 now + 10분). 깊이 알림은 근무시간으로 미룬다 (DV-5) */
    retryAt?: (base: Date) => Date;
    /** 고정 messageId를 붙여 보내 구글이 같은 글을 한 번만 올린다 — 시간 초과 뒤에도 시도 수를 다 쓴다 */
    idempotent?: boolean;
    markSent: (id: number) => Promise<void>;
    markSkipped: (id: number, reason: string) => Promise<void>;
    markFailed: (id: number, error: string) => Promise<void>;
    requeue: (id: number, error: string, at: Date) => Promise<void>;
    /** 보내지 않은 줄을 pending으로 되돌린다 (attempts도 되돌린다). lastError를 주면 남긴다 */
    release: (ids: number[], lastError?: string) => Promise<void>;
    sleep: (ms: number) => Promise<void>;
    log: (message: string) => void;
    /** 로그 머리말 (기본 "[deep-alert]"). 회신 알림은 "[reply-alert]" */
    logPrefix?: string;
}

export interface DeliveryTally {
    sent: number;
    failed: number;
    requeued: number;
    /** 웹훅 없음·보내기 전 재확인으로 닫은 줄 */
    skipped: number;
    /** 웹훅 설정 오류로 보내지 않고 pending으로 되돌린 줄 */
    deferred: number;
    /** 예산을 다 써서 남은 줄을 되돌리고 멈췄다 */
    budgetHit: boolean;
    /** 이번 회차에 웹훅 설정 오류(401·403·404)·웹훅 없음이 난 워크스페이스 — 회차 끝까지 그 워크스페이스 줄은 집지 않는다 */
    brokenWorkspaces: number[];
    /**
     * 이번 회차에 응답이 늦거나(시간 초과) 다시 보내도 실패한(429·5xx·연결) 워크스페이스 — 다른 사업 줄을 먼저 보내게
     * 회차 끝까지 건너뛴다 (CT-5·RC-8)
     */
    stalledWorkspaces: number[];
}

/**
 * 401·403·404는 그 줄이 아니라 웹훅 설정 문제다 (웹훅을 지웠거나, Workspace 관리자가 막았거나, key가 틀림).
 * 이것을 줄 단위 실패로 확정하면 (레코드, 수준) 유니크 키 때문에 웹훅을 고친 뒤에도 그 알림을 다시 만들 수 없다.
 * 400은 글이 잘못된 것이라 그 줄만 실패다.
 */
export function isWebhookConfigError(status: number | null): boolean {
    return status === 401 || status === 403 || status === 404;
}

/** 웹훅 설정 오류로 기다리는 줄의 last_error 머리 (뒤에 구글 챗 결과의 한국어 풀이가 붙는다) */
export const WEBHOOK_WAIT_PREFIX = "웹훅을 고칠 때까지 기다림 — ";

/** 오류 글에 웹훅 주소가 섞여 들어와도 표·응답에 남지 않게 지운다 */
export function scrubWebhook(message: string, webhookUrl: string): string {
    return webhookUrl ? message.split(webhookUrl).join("[webhook]") : message;
}

/**
 * 집은 줄을 한 통씩 보낸다.
 *
 * - skipReasons에 있는 줄(보내기 전 재확인에 걸림)은 보내지 않고 skipped로 닫는다
 * - 웹훅 설정 오류·웹훅 없음이면 그 줄을 pending으로 되돌리고(시도 수도 되돌림) 그 워크스페이스의 남은 줄은 건드리지 않고 되돌린다.
 *   오래 고치지 않으면 예약 시각 24시간 뒤 묵은 줄로 닫힌다 (STALE_AFTER_MS). 운영 스페이스 알림은 chat-webhook-status가 한다
 * - 시간 초과·429·5xx·연결 실패는 그 줄만 10분 뒤로 미루고, 그 워크스페이스의 남은 줄은 이번 회차에 보내지 않는다
 *   (느린 스페이스 하나가 회차 예산을 다 쓰지 않게, CT-5·RC-8)
 * - 예외가 나면 아직 보내지 않은 줄을 바로 되돌린 뒤 예외를 다시 던진다 (processing에 15분 묶이지 않게).
 *   지금 줄을 이미 보냈다면 그 줄은 되돌리지 않는다 — 15분 뒤 reclaimStuck이 처리한다
 *
 * state.posted는 여러 묶음에 걸친 보낸 수다 (보내기 사이 간격을 지키려고).
 */
export async function deliverClaimedBatch(
    batch: readonly ClaimedAlert[],
    skipReasons: ReadonlyMap<number, string>,
    deps: DeliveryDeps,
    state: { posted: number }
): Promise<DeliveryTally> {
    const tally: DeliveryTally = {
        sent: 0,
        failed: 0,
        requeued: 0,
        skipped: 0,
        deferred: 0,
        budgetHit: false,
        brokenWorkspaces: [],
        stalledWorkspaces: [],
    };
    const broken = new Set<number>();
    const stalled = new Set<number>();
    const tag = deps.logPrefix ?? "[deep-alert]";
    const record = async (r: ClaimedAlert, result: GoogleChatResult) => {
        if (!deps.onResult) return;
        try {
            await deps.onResult(r, result);
        } catch {
            // 상태 기록은 보내기를 막지 않는다
        }
    };

    for (let i = 0; i < batch.length; i++) {
        if (deps.overBudget()) {
            // 아직 보내지 않은 줄을 processing에 두면 15분 동안 묶인다 → 바로 되돌린다
            const rest = batch.slice(i).map((r) => r.id);
            await deps.release(rest);
            deps.log(`${tag} 예산 소진, ${rest.length}건 다음 회차로`);
            tally.budgetHit = true;
            break;
        }

        const row = batch[i];
        let attempted = false;
        try {
            const skipReason = skipReasons.get(row.id);
            if (skipReason) {
                await deps.markSkipped(row.id, skipReason);
                tally.skipped++;
                deps.log(`${tag} skipped id=${row.id} record=${row.recordId ?? "-"} (${skipReason})`);
                continue;
            }

            if (broken.has(row.workspaceId) || stalled.has(row.workspaceId)) {
                await deps.release([row.id]);
                tally.deferred++;
                continue;
            }

            const webhookUrl = deps.webhookFor(row.workspaceId);
            if (!webhookUrl) {
                // 닫지 않고 기다린다 — 웹훅을 넣으면 다음 회차에 나가고, 24시간 지나면 묵은 줄로 닫힌다 (DV-15·RC-4)
                await deps.release([row.id], NO_WEBHOOK_WAIT);
                broken.add(row.workspaceId);
                tally.deferred++;
                deps.log(`${tag} 웹훅 없음 workspace=${row.workspaceId} — 넣을 때까지 기다림 (운영 스페이스에 알림)`);
                continue;
            }

            if (state.posted > 0) await deps.sleep(POST_INTERVAL_MS);
            state.posted++;

            attempted = true;
            const text = deps.prepareText ? deps.prepareText(row) : row.message;
            const result = await deps.post(webhookUrl, text, row);
            await record(row, result);
            if (result.ok) {
                await retry(() => deps.markSent(row.id), MARK_SENT_TRIES, MARK_SENT_RETRY_MS, deps.sleep);
                tally.sent++;
                deps.log(`${tag} sent id=${row.id} record=${row.recordId ?? "-"}`);
                continue;
            }

            const lastError = scrubWebhook(result.error, webhookUrl).slice(0, 500);
            if (isWebhookConfigError(result.status)) {
                // 시도로 세지 않고 되돌린다 — 웹훅을 고치면 다음 회차에 나간다
                await deps.release([row.id], `${WEBHOOK_WAIT_PREFIX}${lastError}`.slice(0, 500));
                broken.add(row.workspaceId);
                tally.deferred++;
                deps.log(
                    `${tag} 웹훅 설정 오류 workspace=${row.workspaceId} status=${result.status} — 이번 회차는 이 워크스페이스를 보내지 않음`
                );
                continue;
            }

            // attempts는 집을 때 이미 올렸다 — 처리 중 죽어도 시도가 남아야 무한 재시도를 막는다.
            // 400처럼 다시 보내도 같은 결과인 실패는 기다리지 않고 바로 확정한다.
            // 시간 초과는 구글이 이미 올렸을 수 있다 — 고정 messageId 없이 보낼 때는 두 번째 시도에서 그친다 (같은 카드가 쌓이지 않게, CT-1)
            const uncertainStop = result.uncertain === true && !deps.idempotent && row.attempts >= UNCERTAIN_MAX_ATTEMPTS;
            if (!result.retryable || row.attempts >= MAX_ATTEMPTS || uncertainStop) {
                await deps.markFailed(row.id, uncertainStop ? `${lastError} — ${UNCERTAIN_GIVE_UP_NOTE}`.slice(0, 500) : lastError);
                tally.failed++;
            } else {
                const base = new Date(deps.now.getTime() + RETRY_DELAY_MS);
                await deps.requeue(row.id, lastError, deps.retryAt ? deps.retryAt(base) : base);
                tally.requeued++;
            }
            // 늦거나 다시 보내도 실패한 웹훅은 이번 회차에 더 쓰지 않는다 — 다른 사업 카드를 먼저 보낸다 (CT-5·RC-8)
            if (result.retryable) stalled.add(row.workspaceId);
            deps.log(
                `${tag} post failed id=${row.id} record=${row.recordId ?? "-"} status=${result.status ?? "-"} attempts=${row.attempts}`
            );
        } catch (e) {
            const rest = batch.slice(attempted ? i + 1 : i).map((r) => r.id);
            if (rest.length > 0) {
                try {
                    await deps.release(rest);
                } catch {
                    // DB가 끊긴 경우라면 되돌리기도 실패한다 — 원래 오류를 올리고 15분 뒤 reclaimStuck에 맡긴다
                    deps.log(`${tag} 오류 뒤 되돌리기 실패, ${rest.length}건은 15분 뒤 회수`);
                }
            }
            throw e;
        }
    }

    tally.brokenWorkspaces = [...broken];
    tally.stalledWorkspaces = [...stalled];
    return tally;
}

/** 'sent' 기록 같은 짧은 DB 쓰기를 tries번까지 해 본다 (고객 여정 카드도 같이 쓴다) */
export async function retry(run: () => Promise<void>, tries: number, delayMs: number, sleep: (ms: number) => Promise<void>) {
    for (let attempt = 1; ; attempt++) {
        try {
            await run();
            return;
        } catch (e) {
            if (attempt >= tries) throw e;
            await sleep(delayMs);
        }
    }
}
