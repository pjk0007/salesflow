import { fieldRasterSize } from "@/lib/esign/geometry";

const MAX_FIELD_PNG_BYTES = 83_886;

function fieldCanvas(aspect: number): HTMLCanvasElement {
    if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("입력란 크기를 확인해 주세요.");
    // 서버가 발송 전에 같은 산식(fieldRasterSize)으로 막으므로 새 요청에서는 여기까지 오지 않는다.
    const size = fieldRasterSize({ width: aspect, height: 1 }, { width: 1, height: 1 });
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    if (!size.usable) throw new Error("입력란이 너무 가늘어 내용을 넣을 수 없습니다. 요청자에게 입력란 크기 조정을 요청해 주세요.");
    return canvas;
}

/** One hundred fields stay within the finalizer's shared 8Mpx and 8MiB budget. */
function encodeFieldPng(source: HTMLCanvasElement): string {
    let canvas = source;
    for (;;) {
        const png = canvas.toDataURL("image/png");
        const base64 = png.slice(png.indexOf(",") + 1);
        const bytes = base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
        if (bytes <= MAX_FIELD_PNG_BYTES) return png;
        const width = Math.floor(canvas.width * .85), height = Math.floor(canvas.height * .85);
        if (width < 32 || height < 32) throw new Error("이미지가 너무 복잡해 넣을 수 없습니다. 선명한 서명·도장 PNG로 다시 올려 주세요.");
        const smaller = document.createElement("canvas"); smaller.width = width; smaller.height = height;
        const context = smaller.getContext("2d"); if (!context) throw new Error("이미지를 만들 수 없습니다.");
        context.drawImage(canvas, 0, 0, width, height); canvas = smaller;
    }
}

/** Text is rasterized with the browser's Korean font, only within the signer page. */
export async function textPng(text: string, aspect: number): Promise<string> {
    await document.fonts.ready;
    const canvas = fieldCanvas(aspect);
    const context = canvas.getContext("2d"); if (!context) throw new Error("이미지 생성을 지원하지 않는 브라우저입니다.");
    context.fillStyle = "#111827"; context.textAlign = "center"; context.textBaseline = "middle";
    const minSize = canvas.width * .018, padding = canvas.width * .04, step = canvas.width * .002;
    let size = Math.min(canvas.width * .1, canvas.height * .65);
    context.font = `${size}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;
    while (context.measureText(text).width > canvas.width - padding && size > minSize) { size = Math.max(minSize, size - step); context.font = `${size}px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`; }
    if (context.measureText(text).width > canvas.width - padding) throw new Error("입력 내용이 칸보다 깁니다. 내용을 줄여 주세요.");
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    return encodeFieldPng(canvas);
}
export async function fitPng(source: string, aspect: number): Promise<string> {
    const bitmap = await new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("PNG 이미지를 읽을 수 없습니다.")); image.src = source; });
    if (bitmap.naturalWidth * bitmap.naturalHeight > 4000000) throw new Error("이미지는 400만 픽셀 이하로 올려 주세요.");
    const canvas = fieldCanvas(aspect);
    const context = canvas.getContext("2d"); if (!context) throw new Error("이미지를 만들 수 없습니다.");
    const scale = Math.min(canvas.width / bitmap.naturalWidth, canvas.height / bitmap.naturalHeight);
    const width = bitmap.naturalWidth * scale, height = bitmap.naturalHeight * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return encodeFieldPng(canvas);
}
