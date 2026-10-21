import { ruleOf } from "../email-reply-rules";
export type CampaignKind = "ai" | "template" | "manual";
export interface SendAttrInput {
    id: number;
    orgId: string;
    statDate: string;
    workspaceId: number | null;
    partitionId: number | null;
    triggerType: string | null;
    parentLogId: number | null;
    autoPersonalizedLinkId: number | null;
    templateLinkId: number | null;
    emailTemplateId: number | null;
    senderProfileId: number | null;
    senderDomain: string;
}
export interface ParentAttr {
    sendLogId: number;
    orgId: string;
    rootLogId: number;
    stepIndex: number;
    campaignKind: CampaignKind;
    campaignId: number;
}
export interface SendAttr extends ParentAttr {
    statDate: string;
    workspaceId: number;
    partitionId: number;
    triggerType: string;
    senderProfileId: number;
    senderDomain: string;
}
/** 부모 id가 자식보다 작다는 전제다. 입력을 변경하지 않고 id 오름차순 결과를 반환한다. */
export function resolveAttribution(rows: readonly SendAttrInput[], parents: ReadonlyMap<number, ParentAttr | "missing">): SendAttr[] {
    const resolved = new Map<number, SendAttr>();
    for (const row of [...rows].sort((a, b) => a.id - b.id)) {
        const parent = row.parentLogId === null ? undefined : resolved.get(row.parentLogId) ?? parents.get(row.parentLogId);
        const inherited = parent && parent !== "missing" && parent.orgId === row.orgId ? parent : null;
        const rule = ruleOf(row);
        resolved.set(row.id, {
            sendLogId: row.id,
            orgId: row.orgId,
            statDate: row.statDate,
            workspaceId: row.workspaceId ?? 0,
            partitionId: row.partitionId ?? 0,
            triggerType: row.triggerType ?? "",
            campaignKind: inherited?.campaignKind ?? rule.kind,
            campaignId: inherited?.campaignId ?? rule.id ?? row.emailTemplateId ?? 0,
            rootLogId: inherited?.rootLogId ?? row.id,
            stepIndex: inherited ? inherited.stepIndex + 1 : 0,
            senderProfileId: row.senderProfileId ?? 0,
            senderDomain: row.senderDomain,
        });
    }
    return [...resolved.values()];
}

export function isExcludedSend(send: {
    triggerType: string | null;
    status: string;
}): boolean {
    return send.triggerType?.startsWith("test") === true || send.triggerType === "journey_demo"
        || send.status === "demo" || send.status === "cancelled";
}
