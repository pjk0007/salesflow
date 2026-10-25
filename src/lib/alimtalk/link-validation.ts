import { getAlimtalkClient, type NhnTemplate } from "@/lib/nhn-alimtalk";
import { extractAllTemplateVariables, type AlimtalkFollowupStep } from "@/lib/alimtalk-template-utils";

/**
 * 알림톡 연결(template-links) 저장 전 검사 — 생성(POST)·수정(PUT) 공용.
 *
 * - 수동 연결의 후속·반복 금지(수동 발송은 후속 큐를 만들지 않는다, UX-188)
 * - 반복 설정 형태(간격·횟수·중단 조건 연산자, UX-177)
 * - 기본·후속 단계의 발신 프로필+템플릿 조합 존재(UX-176)와 미매핑 변수(UX-253)
 *
 * 공급자 조회가 실패하면 저장을 막지 않고 warning으로 알린다(발송 시점 검사가 다시 막는다).
 * 수정(PUT)에서는 바뀐 부분만 검사해 기존 연결의 이름 변경·비활성화를 막지 않는다.
 */

export interface RepeatConfigInput {
    intervalHours: number;
    maxRepeat: number;
    stopCondition?: { field?: string; operator?: string; value?: string } | null;
}

export interface LinkConfigInput {
    orgId: string;
    triggerType: string;
    senderKey: string;
    templateCode: string;
    variableMappings: Record<string, string> | null | undefined;
    repeatConfig: RepeatConfigInput | null | undefined;
    followupConfig: AlimtalkFollowupStep | AlimtalkFollowupStep[] | null | undefined;
}

export type LinkValidationResult =
    | { ok: true; warning?: string }
    | { ok: false; error: string };

type TemplateLookup = (senderKey: string, templateCode: string) => Promise<NhnTemplate | null | "unavailable">;

function stepsOf(config: LinkConfigInput["followupConfig"]): AlimtalkFollowupStep[] {
    if (!config) return [];
    return Array.isArray(config) ? config : [config];
}

/** 템플릿이 쓰는 변수 중 매핑이 비어 있는 것 */
export function unmappedTemplateVariables(template: Parameters<typeof extractAllTemplateVariables>[0], mappings: Record<string, string> | null | undefined): string[] {
    return extractAllTemplateVariables(template).filter((v) => !mappings?.[v]?.trim());
}

/** 형태만 보는 검사(공급자 조회 없음) */
export function validateLinkShape(input: Pick<LinkConfigInput, "triggerType" | "repeatConfig" | "followupConfig">): string | null {
    const steps = stepsOf(input.followupConfig);
    if (input.triggerType === "manual") {
        if (steps.length > 0) return "수동 연결에는 후속 발송을 설정할 수 없습니다. 발송 방식을 '생성 시'나 '수정 시'로 바꾸거나 후속 발송을 꺼주세요.";
        if (input.repeatConfig) return "수동 연결에는 반복 발송을 설정할 수 없습니다.";
    }
    if (input.repeatConfig && steps.length > 0) return "반복 발송과 후속 발송은 함께 사용할 수 없습니다.";
    const repeat = input.repeatConfig;
    if (repeat) {
        if (!Number.isFinite(repeat.intervalHours) || repeat.intervalHours <= 0) return "반복 간격을 선택해주세요.";
        if (!Number.isInteger(repeat.maxRepeat) || repeat.maxRepeat < 1 || repeat.maxRepeat > 10) return "반복 최대 횟수는 1~10회로 선택해주세요.";
        const stop = repeat.stopCondition;
        if (stop?.field && !["eq", "ne"].includes(stop.operator ?? "")) return "반복 중단 조건의 비교 방식을 선택해주세요.";
    }
    for (const [i, step] of steps.entries()) {
        if (!step?.templateCode) return `후속 ${i + 1}단계의 템플릿을 선택해주세요.`;
    }
    return null;
}

const defaultLookup = (orgId: string): TemplateLookup => {
    let clientPromise: ReturnType<typeof getAlimtalkClient> | undefined;
    return async (senderKey, templateCode) => {
        try {
            clientPromise ??= getAlimtalkClient(orgId);
            const client = await clientPromise;
            if (!client) return "unavailable";
            const result = await client.getTemplate(senderKey, templateCode);
            if (!result.header?.isSuccessful) return "unavailable";
            return result.template ?? null;
        } catch {
            return "unavailable";
        }
    };
};

/**
 * @param options.previous 수정 시 저장돼 있던 값 — 같은 기본 매핑·같은 단계는 다시 검사하지 않는다.
 * @param options.skipShape 수정 요청이 발송 방식·반복·후속을 바꾸지 않을 때(이름·활성만 변경) 형태 검사를 건너뛴다.
 */
export async function validateLinkConfig(
    input: LinkConfigInput,
    options: { previous?: Pick<LinkConfigInput, "variableMappings" | "followupConfig"> | null; skipShape?: boolean; lookup?: TemplateLookup } = {},
): Promise<LinkValidationResult> {
    const { previous, lookup = defaultLookup(input.orgId) } = options;
    if (!options.skipShape) {
        const shapeError = validateLinkShape(input);
        if (shapeError) return { ok: false, error: shapeError };
    }

    const cache = new Map<string, Promise<NhnTemplate | null | "unavailable">>();
    const find = (senderKey: string, templateCode: string) => {
        const key = `${senderKey}\u0000${templateCode}`;
        if (!cache.has(key)) cache.set(key, lookup(senderKey, templateCode));
        return cache.get(key)!;
    };
    let unavailable = false;
    const notApproved: string[] = [];
    const checkApproval = (template: NhnTemplate, label: string) => {
        // 승인 전 연결 준비는 허용한다 — 승인 전에는 발송되지 않는다는 점만 알린다.
        if (template.status && template.status !== "TSC03") notApproved.push(label);
    };

    const mainChanged = !previous || JSON.stringify(previous.variableMappings ?? {}) !== JSON.stringify(input.variableMappings ?? {});
    if (mainChanged) {
        const template = await find(input.senderKey, input.templateCode);
        if (template === "unavailable") unavailable = true;
        else if (!template) return { ok: false, error: "선택한 발신 프로필에서 템플릿을 찾을 수 없습니다. 발신 프로필과 템플릿을 다시 선택해주세요." };
        else {
            checkApproval(template, "기본 템플릿");
            const missing = unmappedTemplateVariables(template, input.variableMappings);
            if (missing.length > 0) return { ok: false, error: `변수 ${missing.length}개가 매핑되지 않았습니다: ${missing.join(", ")}` };
        }
    }

    // 시간만 바꾼 단계도 채널·템플릿·매핑이 같으면 다시 조회하지 않는다.
    const identity = (s: AlimtalkFollowupStep) => JSON.stringify([s.senderKey ?? "", s.templateCode, s.variableMappings ?? null]);
    const unchanged = new Set(previous ? stepsOf(previous.followupConfig).map(identity) : []);
    for (const [i, step] of stepsOf(input.followupConfig).entries()) {
        if (unchanged.has(identity(step))) continue;
        const senderKey = step.senderKey || input.senderKey;
        const template = await find(senderKey, step.templateCode);
        if (template === "unavailable") { unavailable = true; continue; }
        if (!template) return { ok: false, error: `후속 ${i + 1}단계: 선택한 발신 프로필에서 템플릿을 찾을 수 없습니다. 발신 프로필과 템플릿을 다시 선택해주세요.` };
        checkApproval(template, `후속 ${i + 1}단계`);
        // 실행 규칙과 같다: 단계 매핑이 없으면 기본 연결 매핑을 쓴다.
        const missing = unmappedTemplateVariables(template, step.variableMappings || input.variableMappings);
        if (missing.length > 0) return { ok: false, error: `후속 ${i + 1}단계: 변수 ${missing.length}개가 매핑되지 않았습니다: ${missing.join(", ")}` };
    }

    const warnings = [
        ...(unavailable ? ["알림톡 템플릿을 확인하지 못해 변수·채널 검사를 건너뛰고 저장했습니다. 발송 전에 연결 설정을 다시 확인해주세요."] : []),
        ...(notApproved.length ? [`${notApproved.join(", ")}이(가) 아직 승인되지 않아 승인 전에는 발송되지 않습니다.`] : []),
    ];
    return warnings.length ? { ok: true, warning: warnings.join(" ") } : { ok: true };
}
