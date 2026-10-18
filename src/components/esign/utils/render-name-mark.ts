import { normalizeMarkName, sealCells, type NameMarkKind } from "./name-marks";

const fontFiles = {
    pen: ["Sendb Pen", "SendbPen-Regular.woff2"],
    brush: ["Sendb Brush", "SendbBrush-Regular.woff2"],
    classic: ["Sendb Classic", "SendbClassic-Regular.woff2"],
    light: ["Sendb Light", "SendbLight-Regular.woff2"],
} as const;
const loadedFonts = new Map<string, Promise<string>>();

/** Load only from this application, when the corresponding picker is opened. */
async function loadMarkFont(key: keyof typeof fontFiles): Promise<string> {
    const [family, file] = fontFiles[key];
    let pending = loadedFonts.get(key);
    if (!pending) {
        pending = (async () => {
            const face = new FontFace(family, `url("/esign/fonts/${file}")`, { style: "normal", weight: "400" });
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([face.load(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("글씨체를 불러오지 못했습니다. 다시 시도하거나 직접 그리기·PNG 올리기를 이용해 주세요.")), 15_000); })]);
                document.fonts.add(face);
                return family;
            } finally { clearTimeout(timer); }
        })().catch(() => { loadedFonts.delete(key); throw new Error("글씨체를 불러오지 못했습니다. 다시 시도하거나 직접 그리기·PNG 올리기를 이용해 주세요."); });
        loadedFonts.set(key, pending);
    }
    return pending;
}

function canvasContext(width: number, height: number) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 생성을 지원하지 않는 브라우저입니다.");
    return { canvas, context };
}

/** Fit actual glyph bounds, including bearings/descenders, without stretching letters. */
function fitText(context: CanvasRenderingContext2D, text: string, family: string, cx: number, cy: number, width: number, height: number, ink = false) {
    context.font = `100px "${family}"`; context.textAlign = "left"; context.textBaseline = "alphabetic";
    const metric = context.measureText(text);
    const left = metric.actualBoundingBoxLeft, right = metric.actualBoundingBoxRight;
    const ascent = metric.actualBoundingBoxAscent, descent = metric.actualBoundingBoxDescent;
    const scale = Math.min(width / Math.max(1, left + right), height / Math.max(1, ascent + descent));
    context.save(); context.translate(cx, cy); context.scale(scale, scale);
    const x = (left - right) / 2, y = (ascent - descent) / 2;
    context.fillText(text, x, y);
    if (ink) { context.lineWidth = .7; context.strokeText(text, x, y); }
    context.restore();
}

/** Keep the selected mark large enough in its target field without transparent canvas margins. */
function trimmedPng(source: HTMLCanvasElement): string {
    const context = source.getContext("2d")!;
    const { data } = context.getImageData(0, 0, source.width, source.height);
    let left = source.width, right = -1, top = source.height, bottom = -1;
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        if (data[(y * source.width + x) * 4 + 3] > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (right < left) throw new Error("이 이름으로 이미지를 만들지 못했습니다. 다른 입력 방법을 이용해 주세요.");
    const padding = 12, { canvas, context: target } = canvasContext(right - left + 1 + padding * 2, bottom - top + 1 + padding * 2);
    target.drawImage(source, left, top, right - left + 1, bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1);
    return canvas.toDataURL("image/png");
}

export async function renderNameMark(name: string, kind: NameMarkKind, style: string): Promise<string> {
    name = normalizeMarkName(name, kind);
    if (kind === "signature") {
        if (!(style in fontFiles)) throw new Error("서명 스타일을 다시 선택해 주세요.");
        const family = await loadMarkFont(style as keyof typeof fontFiles);
        const { canvas, context } = canvasContext(760, 240);
        context.fillStyle = "#172033";
        fitText(context, name, family, 380, 120, 680, 152);
        return trimmedPng(canvas);
    }
    const oval = style === "oval", square = style === "square" || style === "rounded-square";
    if (!["round", "double-round", "square", "rounded-square", "oval", "brush-round"].includes(style)) throw new Error("도장 스타일을 다시 선택해 주세요.");
    const family = await loadMarkFont(style === "brush-round" ? "brush" : "classic");
    const { canvas, context } = canvasContext(360, oval ? 480 : 360);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    context.strokeStyle = context.fillStyle = "#b52929";
    context.lineWidth = style === "brush-round" ? 9 : 7;
    context.lineJoin = "round";
    const outline = (inset: number) => {
        context.beginPath();
        if (square) context.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, style === "rounded-square" ? 34 : 3);
        else context.ellipse(cx, cy, cx - inset, cy - inset, 0, 0, 2 * Math.PI);
        context.stroke();
    };
    outline(16);
    if (["double-round", "square"].includes(style)) { context.lineWidth = 3; outline(30); }
    const width = square ? 238 : oval ? 185 : 214, height = square ? 238 : oval ? 362 : 214;
    for (const cell of sealCells(name, oval)) {
        const cellWidth = width / cell.columns, cellHeight = height / cell.rows;
        fitText(context, cell.character, family,
            cx - width / 2 + (cell.column + .5) * cellWidth,
            cy - height / 2 + (cell.row + .5) * cellHeight,
            cellWidth * .86, cellHeight * .86, true);
    }
    return trimmedPng(canvas);
}
