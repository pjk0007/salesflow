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
/** 'sent' 기록이 일시 DB 오류로 실패하면 짧게 다시 해 본다 — 이미 올라간 카드가 15분 뒤 다시 나가지 않게 */
const MARK_SENT_TRIES = 3;
const MARK_SENT_RETRY_MS = 300;

/** 집은 줄 (attempts는 집을 때 올린 뒤의 값) */
export interface ClaimedAlert {
    id: number;
    workspaceId: number;
    recordId: number;
    message: string;
    attempts: number;
}

export interface DeliveryDeps {
    now: Date;
    overBudget: () => boolean;
    webhookFor: (workspaceId: number) => string | undefined;
    post: (webhookUrl: string, text: string) => Promise<GoogleChatResult>;
    markSent: (id: number) => Promise<void>;
    markSkipped: (id: number, reason: string) => Promise<void>;
    markFailed: (id: number, error: string) => Promise<void>;
    requeue: (id: number, error: string, at: Date) => Promise<void>;
    /** 보내지 않은 줄을 pending으로 되돌린다 (attempts도 되돌린다). lastError를 주면 남긴다 */
    release: (ids: number[], lastError?: string) => Promise<void>;
    sleep: (ms: number) => Promise<void>;
    log: (message: string) => void;
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
    /** 이번 회차에 웹훅 설정 오류(401·403·404)가 난 워크스페이스 — 회차 끝까지 그 워크스페이스 줄은 집지 않는다 */
    brokenWorkspaces: number[];
}

/**
 * 401·403·404는 그 줄이 아니라 웹훅 설정 문제다 (웹훅을 지웠거나, Workspace 관리자가 막았거나, key가 틀림).
 * 이것을 줄 단위 실패로 확정하면 (레코드, 수준) 유니크 키 때문에 웹훅을 고친 뒤에도 그 알림을 다시 만들 수 없다.
 * 400은 글이 잘못된 것이라 그 줄만 실패다.
 */
export function isWebhookConfigError(status: number | null): boolean {
    return status === 401 || status === 403 || status === 404;
}

/** 오류 글에 웹훅 주소가 섞여 들어와도 표·응답에 남지 않게 지운다 */
export function scrubWebhook(message: string, webhookUrl: string): string {
    return webhookUrl ? message.split(webhookUrl).join("[webhook]") : message;
}

/**
 * 집은 줄을 한 통씩 보낸다.
 *
 * - skipReasons에 있는 줄(보내기 전 재확인에 걸림)은 보내지 않고 skipped로 닫는다
 * - 웹훅 설정 오류면 그 줄을 pending으로 되돌리고(시도 수도 되돌림) 그 워크스페이스의 남은 줄은 건드리지 않고 되돌린다.
 *   오래 고치지 않으면 예약 시각 24시간 뒤 묵은 줄로 닫힌다 (STALE_AFTER_MS)
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
    };
    const broken = new Set<number>();

    for (let i = 0; i < batch.length; i++) {
        if (deps.overBudget()) {
            // 아직 보내지 않은 줄을 processing에 두면 15분 동안 묶인다 → 바로 되돌린다
            const rest = batch.slice(i).map((r) => r.id);
            await deps.release(rest);
            deps.log(`[deep-alert] 예산 소진, ${rest.length}건 다음 회차로`);
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
                deps.log(`[deep-alert] skipped id=${row.id} record=${row.recordId} (${skipReason})`);
                continue;
            }

            if (broken.has(row.workspaceId)) {
                await deps.release([row.id]);
                tally.deferred++;
                continue;
            }

            const webhookUrl = deps.webhookFor(row.workspaceId);
            if (!webhookUrl) {
                await deps.markSkipped(row.id, NO_WEBHOOK_ERROR);
                tally.skipped++;
                continue;
            }

            if (state.posted > 0) await deps.sleep(POST_INTERVAL_MS);
            state.posted++;

            attempted = true;
            const result = await deps.post(webhookUrl, row.message);
            if (result.ok) {
                await retry(() => deps.markSent(row.id), MARK_SENT_TRIES, MARK_SENT_RETRY_MS, deps.sleep);
                tally.sent++;
                deps.log(`[deep-alert] sent id=${row.id} record=${row.recordId}`);
                continue;
            }

            const lastError = scrubWebhook(result.error, webhookUrl).slice(0, 500);
            if (isWebhookConfigError(result.status)) {
                // 시도로 세지 않고 되돌린다 — 웹훅을 고치면 다음 회차에 나간다
                await deps.release([row.id], `웹훅 설정 오류, 주소를 고칠 때까지 기다림 — ${lastError}`.slice(0, 500));
                broken.add(row.workspaceId);
                tally.deferred++;
                deps.log(
                    `[deep-alert] 웹훅 설정 오류 workspace=${row.workspaceId} status=${result.status} — 이번 회차는 이 워크스페이스를 보내지 않음`
                );
                continue;
            }

            // attempts는 집을 때 이미 올렸다 — 처리 중 죽어도 시도가 남아야 무한 재시도를 막는다.
            // 400처럼 다시 보내도 같은 결과인 실패는 기다리지 않고 바로 확정한다.
            if (!result.retryable || row.attempts >= MAX_ATTEMPTS) {
                await deps.markFailed(row.id, lastError);
                tally.failed++;
            } else {
                await deps.requeue(row.id, lastError, new Date(deps.now.getTime() + RETRY_DELAY_MS));
                tally.requeued++;
            }
            deps.log(
                `[deep-alert] post failed id=${row.id} record=${row.recordId} status=${result.status ?? "-"} attempts=${row.attempts}`
            );
        } catch (e) {
            const rest = batch.slice(attempted ? i + 1 : i).map((r) => r.id);
            if (rest.length > 0) {
                try {
                    await deps.release(rest);
                } catch {
                    // DB가 끊긴 경우라면 되돌리기도 실패한다 — 원래 오류를 올리고 15분 뒤 reclaimStuck에 맡긴다
                    deps.log(`[deep-alert] 오류 뒤 되돌리기 실패, ${rest.length}건은 15분 뒤 회수`);
                }
            }
            throw e;
        }
    }

    tally.brokenWorkspaces = [...broken];
    return tally;
}

async function retry(run: () => Promise<void>, tries: number, delayMs: number, sleep: (ms: number) => Promise<void>) {
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
