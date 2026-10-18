import { normalizeMarkName, SIGNATURE_STYLES, type NameMarkKind, type SealOptions } from "./name-marks";
import { canvasContext, fitText, loadMarkFont, trimmedPng } from "./mark-canvas";
import { renderSeal } from "./render-seal";

export async function renderNameMark(name: string, kind: NameMarkKind, style: string, options?: SealOptions): Promise<string> {
    if (kind === "seal") return renderSeal(name, style, options);
    name = normalizeMarkName(name, kind);
    if (!SIGNATURE_STYLES.some(item => item.id === style)) throw new Error("서명 스타일을 다시 선택해 주세요.");
    const family = await loadMarkFont(style as "pen" | "brush" | "classic" | "light");
    const { canvas, context } = canvasContext(760, 240);
    context.fillStyle = "#172033";
    fitText(context, name, family, 380, 120, 680, 152);
    return trimmedPng(canvas);
}
