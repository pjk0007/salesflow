import type { SelectedAsset } from "../types";

// 에셋 URL 목록을 이메일 본문용 <img> 태그 문자열로. 모바일에서 넘치지 않게 max-width 100%.
export function assetsToImgHtml(assets: SelectedAsset[]): string {
    return assets
        .map((a) => `<img src="${a.url}" alt="" style="max-width:100%;height:auto;" />`)
        .join("");
}

// textarea의 현재 커서 위치(selectionStart~End)에 text를 삽입한 새 문자열과 새 커서 위치를 반환.
export function insertAtCursor(
    original: string,
    selectionStart: number,
    selectionEnd: number,
    text: string
): { next: string; cursor: number } {
    const next = original.slice(0, selectionStart) + text + original.slice(selectionEnd);
    return { next, cursor: selectionStart + text.length };
}

/**
 * contenteditable 편집기의 저장해 둔 커서(range) 위치에 html을 넣고, 넣은 뒤 위치의 range를 돌려준다.
 * 커서가 편집기 밖이거나 없으면 본문 끝에 넣는다. 에셋 선택 창이 초점을 가둔 상태에서도 동작하도록
 * 현재 초점·선택 영역에 기대는 execCommand를 쓰지 않는다 (UX-145).
 */
export function insertHtmlIntoEditor(editor: HTMLElement, range: Range | null, html: string): Range {
    let target = range && editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    if (!target) {
        target = editor.ownerDocument.createRange();
        target.selectNodeContents(editor);
        target.collapse(false);
    }
    target.deleteContents();
    const fragment = target.createContextualFragment(html);
    const last = fragment.lastChild;
    target.insertNode(fragment);
    if (last) target.setStartAfter(last);
    target.collapse(true);
    return target;
}
