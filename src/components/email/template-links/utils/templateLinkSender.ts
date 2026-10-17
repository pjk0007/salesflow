export function isManualTrigger(triggerType: string): boolean {
    return triggerType === "manual";
}

/** 수동 연결은 저장된 발신 묶음을 지우지 않도록 발신 칸을 생략한다. */
export function templateLinkSenderBody(triggerType: string, ids: readonly number[]): { senderProfileIds?: number[] } {
    return isManualTrigger(triggerType) ? {} : { senderProfileIds: [...ids] };
}
