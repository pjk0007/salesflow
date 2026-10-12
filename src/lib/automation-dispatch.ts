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
    // 한 건씩 생긴 레코드(화면 단건 추가·v1 API·Meta 웹훅·수정)는 문의다 — 그날 한도 전체(문의 몫 포함)를 쓴다 (DESIGN-2 2절)
    processAutoPersonalizedEmail({ ...params, purpose: "inbound" })
        .then((result) => {
            // 발신 한도·시간대에 막힌 메일은 여기서 버리면 사라진다 — 발송 대기열에 retryAt으로 넣어 워커가 이어받게 한다.
            // 문의 줄(priority 1)로 들어가 다음에 열릴 때 대량 명단보다 먼저 나간다
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
