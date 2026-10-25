/**
 * 이메일 템플릿 편집기의 저장 기준(스냅샷)과 자동저장 규칙.
 * 발송 경로는 템플릿 status를 보지 않으므로, 발행 템플릿을 자동저장·임시저장하면 편집 중인 본문이 그대로 발송된다 (UX-147).
 */
export interface TemplateSnapshot {
    name: string;
    subject: string;
    htmlBody: string;
    templateType: string;
    categoryId: number | null;
    useUnsubscribe: boolean;
}

/** 저장 요청에 담기는 필드 전부를 비교한다 — 수신거부·카테고리만 바꿔도 변경으로 본다 (UX-142) */
export function isSnapshotDirty(saved: TemplateSnapshot | null, current: TemplateSnapshot): boolean {
    if (!saved) {
        return !!(current.name || current.subject || current.htmlBody);
    }
    return (Object.keys(current) as (keyof TemplateSnapshot)[]).some((key) => saved[key] !== current[key]);
}

/** 새 템플릿·초안만 임시저장(자동·수동)한다. 발행 템플릿은 '수정'으로만 확정한다 */
export function canSaveAsDraft(status: string | null | undefined): boolean {
    return status !== "published";
}
