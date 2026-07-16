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
