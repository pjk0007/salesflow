import { processAutoTrigger } from "./alimtalk-automation";
import { processEmailAutoTrigger } from "./email-automation";
import { processAutoPersonalizedEmail } from "./auto-personalized-email";
import { deferredUntil } from "./auto-personalized-email-outcome";
import { enqueueDeferredSend } from "./email-send-queue";
import type { DbRecord } from "@/lib/db";

interface AutoTriggerParams {
    record: DbRecord;
    partitionId: number;
    triggerType: "on_create" | "on_update";
    orgId: string;
}

/** 모든 자동화 트리거를 한 번에 실행 (각각 독립적으로 에러 핸들링) */
export function dispatchAutoTriggers(params: AutoTriggerParams): void {
    processAutoTrigger(params).catch((err) =>
        console.error("Alimtalk auto trigger error:", err)
    );
    processEmailAutoTrigger(params).catch((err) =>
        console.error("Email auto trigger error:", err)
    );
    processAutoPersonalizedEmail(params)
        .then((result) => {
            // 발신 한도·시간대에 막힌 메일은 여기서 버리면 사라진다 — 발송 대기열에 retryAt으로 넣어 워커가 이어받게 한다
            const deferral = deferredUntil(result);
            if (!deferral) return;
            return enqueueDeferredSend({
                recordId: params.record.id,
                partitionId: params.partitionId,
                orgId: params.orgId,
                triggerType: params.triggerType,
                retryAt: deferral.retryAt,
                reason: deferral.reason,
            });
        })
        .catch((err) =>
            console.error("Auto personalized email error:", err)
        );
}
