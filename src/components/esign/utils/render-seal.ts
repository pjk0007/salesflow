import { canvasContext, fitText, loadMarkFont, trimmedPng } from "./mark-canvas";
import { COMPANY_SEAL_STYLES, PERSONAL_SEAL_STYLES, normalizeCompanySealName, normalizeMarkName, normalizeSealCenter, sealCells, type SealOptions } from "./name-marks";
import { drawEngravedCharacter } from "./seal-lettering";

const INK = "#9e2428";
function petalFrame(context: CanvasRenderingContext2D, cx: number, cy: number, radius: number, petals: number, depth: number) {
    context.beginPath();
    for (let i = 0; i <= 360; i++) {
        const angle = i * Math.PI / 180, r = radius + depth * Math.cos(petals * (angle + Math.PI / 2));
        const x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
        if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.closePath(); context.stroke();
}
function circle(context: CanvasRenderingContext2D, cx: number, cy: number, radius: number, width: number) {
    context.lineWidth = width; context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke();
}
function blossom(context: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
    context.save(); context.translate(cx, cy); context.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) { context.rotate(Math.PI * 2 / 5); context.beginPath(); context.ellipse(0, -size * .45, size * .32, size * .45, 0, 0, Math.PI * 2); context.stroke(); }
    context.beginPath(); context.arc(0, 0, size * .13, 0, Math.PI * 2); context.fill(); context.restore();
}

/** No external artwork or existing seal impression is copied; all ornament paths are generated here. */
export async function renderSeal(rawName: string, style: string, options: SealOptions = { category: "personal", font: "engraved", centerText: "대표이사" }) {
    const company = options.category === "company";
    const styles = company ? COMPANY_SEAL_STYLES : PERSONAL_SEAL_STYLES;
    if (!styles.some(item => item.id === style)) throw new Error("도장 모양을 다시 선택해 주세요.");
    if (!["engraved", "serif", "formal"].includes(options.font)) throw new Error("도장 서체를 다시 선택해 주세요.");
    const name = company ? normalizeCompanySealName(rawName) : normalizeMarkName(rawName, "seal");
    const centerText = company ? normalizeSealCenter(options.centerText) : "";
    const family = await loadMarkFont(options.font === "formal" ? "sealFormal" : "sealSerif");
    const oval = style === "slender-oval", square = style.includes("square") || style.includes("meander") || style === "company-inverse";
    const inverse = style.includes("intaglio") || style.includes("inverse");
    const { canvas, context } = canvasContext(420, oval ? 560 : 420);
    const cx = 210, cy = canvas.height / 2;
    context.fillStyle = context.strokeStyle = INK;
    context.lineWidth = 8; context.lineJoin = "round";
    const character = (char: string, x: number, y: number, width: number, height: number) => {
        if (options.font === "engraved" && drawEngravedCharacter(context, char, x, y, width, height)) return;
        fitText(context, char, family, x, y, width * .9, height * .9, true);
    };
    const grid = (text: string, x: number, y: number, width: number, height: number, columns: number) => {
        const chars = [...text], rows = Math.ceil(chars.length / columns);
        chars.forEach((char, i) => {
            const column = Math.floor(i / rows), row = i % rows, inColumn = Math.min(rows, chars.length - column * rows);
            const cellW = width / columns, cellH = height / rows;
            character(char, x + width / 2 - (column + .5) * cellW, y - height / 2 + (row + .5 + (rows - inColumn) / 2) * cellH, cellW * .94, cellH * .94);
        });
    };

    if (square) {
        context.beginPath(); context.roundRect(23, 23, 374, 374, 9);
        if (inverse) { context.fill(); context.globalCompositeOperation = "destination-out"; context.lineWidth = 3; context.beginPath(); context.roundRect(34, 34, 352, 352, 4); context.stroke(); }
        else { context.stroke(); context.lineWidth = 2.5; context.strokeRect(35, 35, 350, 350); }
        if (style === "company-meander") {
            context.save(); context.lineWidth = 3;
            for (let i = 0; i < 4; i++) { context.translate(cx, cy); context.rotate(Math.PI / 2); context.translate(-cx, -cy); context.beginPath(); context.moveTo(47, 85); context.lineTo(47, 47); context.lineTo(85, 47); context.lineTo(85, 64); context.lineTo(64, 64); context.stroke(); }
            context.restore();
        }
        if (company) {
            grid(name, cx, style === "company-meander" ? 184 : 175, style === "company-meander" ? 264 : 312, style === "company-meander" ? 220 : 245, Math.max(2, Math.ceil(Math.sqrt([...name].length))));
            context.lineWidth = 2.5; context.beginPath(); context.moveTo(54, 312); context.lineTo(366, 312); context.stroke();
            fitText(context, centerText, family, cx, 349, style === "company-meander" ? 236 : 292, 44);
        } else {
            const cells = sealCells(name); grid(cells.map(c => c.character).join(""), cx, cy, 320, 320, cells[0].columns);
        }
    } else if (company) {
        circle(context, cx, cy, 187, 7); circle(context, cx, cy, 176, 2.2); circle(context, cx, cy, 110, 2.5);
        const chars = [...name], arc = Math.min(1.64 * Math.PI, Math.max(.7 * Math.PI, chars.length * .32));
        const size = Math.min(42, 143 * arc / chars.length * .76);
        chars.forEach((char, i) => {
            const angle = -Math.PI / 2 - arc / 2 + arc * (i + .5) / chars.length;
            context.save(); context.translate(cx + 143 * Math.cos(angle), cy + 143 * Math.sin(angle)); context.rotate(angle + Math.PI / 2);
            fitText(context, char, family, 0, 0, size, size, true); context.restore();
        });
        grid(centerText, cx, cy, 144, 157, [...centerText].length <= 3 ? 1 : 2);
        if (style === "company-beaded") {
            for (let i = 0; i < 56; i++) { const angle = i * Math.PI * 2 / 56; context.beginPath(); context.arc(cx + 166 * Math.cos(angle), cy + 166 * Math.sin(angle), 1.6, 0, Math.PI * 2); context.fill(); }
        }
        if (style === "company-floral") {
            blossom(context, cx, cy + 144, 15);
            for (let i = 0; i < 4; i++) {
                const angle = Math.PI / 4 + i * Math.PI / 2, x = cx + 181 * Math.cos(angle), y = cy + 181 * Math.sin(angle);
                context.save(); context.globalCompositeOperation = "destination-out"; context.beginPath(); context.arc(x, y, 13, 0, Math.PI * 2); context.fill(); context.restore();
                blossom(context, x, y, 12);
            }
        }
        else { context.beginPath(); context.moveTo(cx - 12, cy + 145); context.lineTo(cx, cy + 133); context.lineTo(cx + 12, cy + 145); context.lineTo(cx, cy + 157); context.closePath(); context.fill(); }
    } else {
        if (oval) { context.beginPath(); context.ellipse(cx, cy, 152, 251, 0, 0, Math.PI * 2); context.stroke(); context.lineWidth = 2.5; context.beginPath(); context.ellipse(cx, cy, 141, 240, 0, 0, Math.PI * 2); context.stroke(); }
        else if (style === "plum-blossom") { petalFrame(context, cx, cy, 174, 5, 17); context.lineWidth = 2.5; petalFrame(context, cx, cy, 163, 5, 16); }
        else if (style === "cloud-border") { petalFrame(context, cx, cy, 174, 4, 15); context.lineWidth = 2.5; petalFrame(context, cx, cy, 161, 4, 14); }
        else { circle(context, cx, cy, 187, 7); circle(context, cx, cy, 175, 2.5); }
        const cells = sealCells(name, oval);
        const decorative = style === "plum-blossom" || style === "cloud-border";
        grid(cells.map(c => c.character).join(""), cx, cy, oval ? 203 : decorative ? 216 : 252, oval ? 435 : decorative ? 216 : 252, cells[0].columns);
    }
    return trimmedPng(canvas);
}
