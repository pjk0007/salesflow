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
