// Client-safe utils for alimtalk template variable extraction.
// 이 파일은 서버 전용 모듈(db 등)을 import 하지 않아 client component에서 안전하게 사용 가능.

interface VariableExtractable {
    templateContent?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: {
        list?: Array<{ title?: string; description?: string }>;
        summary?: { title?: string; description?: string };
    };
    templateItemHighlight?: {
        title?: string;
        description?: string;
    };
    buttons?: Array<{
        name?: string;
        linkMo?: string;
        linkPc?: string;
    }>;
    quickReplies?: Array<{
        name?: string;
        linkMo?: string;
        linkPc?: string;
    }>;
}

/**
 * 알림톡·SMS 수신번호 정규화: 숫자만 남기고 국가번호 형식 휴대폰(+82 10…, 82 010…)은 국내 번호(010…)로 바꾼다.
 * NHN 국내 발송은 국내 번호를 기대한다(전자서명 rules와 같은 규칙, UX-270).
 */
export function normalizePhoneNumber(phone: string): string {
    return phone.replace(/[^0-9]/g, "").replace(/^820?(1[016789])/, "0$1");
}

/** 단순 문자열에서 #{변수} 패턴 추출 (중복 제거) */
export function extractTemplateVariables(content: string): string[] {
    const matches = content.match(/#\{([^}]+)\}/g);
    if (!matches) return [];
    return [...new Set(matches)];
}

/**
 * NHN 알림톡 템플릿 객체에서 모든 변수 노출 영역의 #{...} 변수를 추출합니다.
 * 본문(content)뿐 아니라 부가정보, 헤더, 아이템 리스트, 강조, 버튼, 퀵리플라이까지 스캔.
 */
export function extractAllTemplateVariables(
    template: VariableExtractable | null | undefined
): string[] {
    if (!template) return [];

    const sources: string[] = [];

    if (template.templateContent) sources.push(template.templateContent);
    if (template.templateExtra) sources.push(template.templateExtra);
    if (template.templateTitle) sources.push(template.templateTitle);
    if (template.templateSubtitle) sources.push(template.templateSubtitle);
    if (template.templateHeader) sources.push(template.templateHeader);

    if (template.templateItem) {
        for (const item of template.templateItem.list ?? []) {
            if (item.title) sources.push(item.title);
            if (item.description) sources.push(item.description);
        }
        if (template.templateItem.summary) {
            if (template.templateItem.summary.title) sources.push(template.templateItem.summary.title);
            if (template.templateItem.summary.description) sources.push(template.templateItem.summary.description);
        }
    }

    if (template.templateItemHighlight) {
        if (template.templateItemHighlight.title) sources.push(template.templateItemHighlight.title);
        if (template.templateItemHighlight.description) sources.push(template.templateItemHighlight.description);
    }

    for (const btn of template.buttons ?? []) {
        if (btn.name) sources.push(btn.name);
        if (btn.linkMo) sources.push(btn.linkMo);
        if (btn.linkPc) sources.push(btn.linkPc);
    }
    for (const qr of template.quickReplies ?? []) {
        if (qr.name) sources.push(qr.name);
        if (qr.linkMo) sources.push(qr.linkMo);
        if (qr.linkPc) sources.push(qr.linkPc);
    }

    const allText = sources.join("\n");
    return extractTemplateVariables(allText);
}

/**
 * 미리보기용으로 문자열을 텍스트·#{변수} 조각으로 나눈다(변수 규칙은 extractTemplateVariables와 같다).
 * 화면은 조각을 React 텍스트 노드로 렌더링한다 — 입력한 HTML 형태 문자열을 태그로 해석하지 않는다.
 */
export function splitTemplateVariables(content: string | null | undefined): Array<{ text: string; variable: boolean }> {
    const parts: Array<{ text: string; variable: boolean }> = [];
    if (!content) return parts;
    let last = 0;
    for (const match of content.matchAll(/#\{([^}]+)\}/g)) {
        const index = match.index ?? 0;
        if (index > last) parts.push({ text: content.slice(last, index), variable: false });
        parts.push({ text: match[0], variable: true });
        last = index + match[0].length;
    }
    if (last < content.length) parts.push({ text: content.slice(last), variable: false });
    return parts;
}

/** 발송 API templateParameter 키(#{...}를 벗긴 이름) — 템플릿 모든 노출 영역 기준, 중복 제거 */
export function extractTemplateParameterKeys(template: VariableExtractable | null | undefined): string[] {
    return extractAllTemplateVariables(template).map((v) => v.slice(2, -1));
}

export interface AlimtalkFollowupStep {
    delayDays?: number; delayHours?: number; delayMinutes?: number;
    senderKey?: string; templateCode: string; variableMappings?: Record<string, string>;
}
export interface FollowupStepUI {
    delayValue: number; delayUnit: "minutes" | "hours" | "days";
    senderKey: string; templateCode: string; variableMappings: Record<string, string>;
}
/** 기존 합산 지연을 분 단위까지 보존한다. 단위를 바꿔 재저장해도 발송 시점이 달라지지 않는다. */
export function loadAlimtalkFollowupSteps(config: AlimtalkFollowupStep | AlimtalkFollowupStep[] | null | undefined): FollowupStepUI[] {
    return (config ? Array.isArray(config) ? config : [config] : []).map(step => {
        const minutes = (step.delayDays ?? 0) * 1440 + (step.delayHours ?? 0) * 60 + (step.delayMinutes ?? 0) || 1440;
        const delayUnit = minutes % 1440 === 0 ? "days" : minutes % 60 === 0 ? "hours" : "minutes";
        return { delayValue: minutes / (delayUnit === "days" ? 1440 : delayUnit === "hours" ? 60 : 1), delayUnit,
            senderKey: step.senderKey ?? "", templateCode: step.templateCode, variableMappings: step.variableMappings ?? {} };
    });
}
export function saveAlimtalkFollowupSteps(steps: FollowupStepUI[]) {
    return steps.map(step => ({
        ...(step.delayUnit === "minutes" ? { delayMinutes: step.delayValue } : step.delayUnit === "hours" ? { delayHours: step.delayValue } : { delayDays: step.delayValue }),
        templateCode: step.templateCode, ...(step.senderKey ? { senderKey: step.senderKey } : {}),
        ...(Object.keys(step.variableMappings).length ? { variableMappings: step.variableMappings } : {}),
    }));
}
