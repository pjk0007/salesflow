import { processAutoTrigger } from "./alimtalk-automation";
import { processEmailAutoTrigger } from "./email-automation";
import { processAutoPersonalizedEmail } from "./auto-personalized-email";
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
    processAutoPersonalizedEmail(params).catch((err) =>
        console.error("Auto personalized email error:", err)
    );
}
