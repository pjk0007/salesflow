const fontFiles = {
    pen: ["Sendb Pen", "SendbPen-Regular.woff2"],
    brush: ["Sendb Brush", "SendbBrush-Regular.woff2"],
    classic: ["Sendb Classic", "SendbClassic-Regular.woff2"],
    light: ["Sendb Light", "SendbLight-Regular.woff2"],
    doan: ["Sendb Seal Doan", "SendbSealDoan-Regular.woff2"],
    jeonseo: ["Sendb Seal Jeonseo", "SendbSealJeonseo-Regular.woff2"],
    gilsang: ["Sendb Seal Gilsang", "SendbSealGilsang-Regular.woff2"],
} as const;
const loadedFonts = new Map<string, Promise<string>>();

/** Same-origin, lazy, shared between mark styles; failed loads can be retried. */
export async function loadMarkFont(key: keyof typeof fontFiles): Promise<string> {
    const [family, file] = fontFiles[key];
    return loadLocalFont(key, family, file);
}

/** CNS chunks contain at most 128 code points; load only the entered characters. */
export async function loadHanjaSealFont(text: string): Promise<string> {
    const family = "Sendb Seal CNS", blocks = new Set([...text].filter(char => (char.codePointAt(0) ?? 0) >= 0x3400).map(char => Math.floor(char.codePointAt(0)! / 128) * 128));
    await Promise.all([...blocks].map(block => loadLocalFont(`cns-${block}`, family, `SendbSealCNS-${block.toString(16)}.woff2`, `U+${block.toString(16)}-${(block + 127).toString(16)}`)));
    return family;
}

async function loadLocalFont(key: string, family: string, file: string, unicodeRange?: string): Promise<string> {
    let pending = loadedFonts.get(key);
    if (!pending) {
        pending = (async () => {
            const face = new FontFace(family, `url("/esign/fonts/${file}")`, { style: "normal", weight: "400", ...(unicodeRange ? { unicodeRange } : {}) });
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([face.load(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("font timeout")), 15_000); })]);
                document.fonts.add(face); return family;
            } finally { clearTimeout(timer); }
        })().catch(() => { loadedFonts.delete(key); throw new Error("글씨체를 불러오지 못했습니다. 다시 시도하거나 직접 그리기·PNG 올리기를 이용해 주세요."); });
        loadedFonts.set(key, pending);
    }
    return pending;
}

export function canvasContext(width: number, height: number) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 생성을 지원하지 않는 브라우저입니다.");
    return { canvas, context };
}

export function fitText(context: CanvasRenderingContext2D, text: string, family: string, cx: number, cy: number, width: number, height: number, fillBox = false, strokeWidth = 0) {
    context.font = `100px "${family}"`; context.textAlign = "left"; context.textBaseline = "alphabetic";
    const metric = context.measureText(text);
    const left = metric.actualBoundingBoxLeft, right = metric.actualBoundingBoxRight;
    const ascent = metric.actualBoundingBoxAscent, descent = metric.actualBoundingBoxDescent;
    const sx = width / Math.max(1, left + right), sy = height / Math.max(1, ascent + descent), scale = Math.min(sx, sy);
    context.save(); context.translate(cx, cy); context.scale(fillBox ? sx : scale, fillBox ? sy : scale);
    context.fillText(text, (left - right) / 2, (ascent - descent) / 2);
    if (strokeWidth > 0) { context.lineWidth = strokeWidth; context.lineJoin = "round"; context.strokeText(text, (left - right) / 2, (ascent - descent) / 2); }
    context.restore();
}

export function trimmedPng(source: HTMLCanvasElement): string {
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
