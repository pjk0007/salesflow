import { canvasContext, fitText, loadHanjaSealFont, loadMarkFont, trimmedPng } from "./mark-canvas";
import { COMPANY_SEAL_STYLES, PERSONAL_SEAL_STYLES, SEAL_FONTS, normalizeCompanySealName, normalizeMarkName, normalizeSealCenter, sealCells, type SealOptions } from "./name-marks";
import { requireSealCharacters, sealCharacterScript } from "./seal-font-coverage";

const INK = "#d11920";
function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, width: number, fill = false) {
    context.lineWidth = width; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) context.fill(); else context.stroke();
}

/** Pack lettering into a disc, as in a carved round seal, preserving transparent pixels. */
function roundLettering(source: HTMLCanvasElement) {
    const size = source.width, { canvas, context } = canvasContext(size, size);
    const input = source.getContext("2d")!.getImageData(0, 0, size, size).data;
    const output = context.createImageData(size, size), data = output.data, root2 = Math.SQRT2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (x + .5) * 2 / size - 1, dy = (y + .5) * 2 / size - 1;
        if (dx * dx + dy * dy > 1) continue;
        const u = (Math.sqrt(Math.max(0, 2 + dx * dx - dy * dy + 2 * root2 * dx)) - Math.sqrt(Math.max(0, 2 + dx * dx - dy * dy - 2 * root2 * dx))) / 2;
        const v = (Math.sqrt(Math.max(0, 2 - dx * dx + dy * dy + 2 * root2 * dy)) - Math.sqrt(Math.max(0, 2 - dx * dx + dy * dy - 2 * root2 * dy))) / 2;
        const sx = Math.max(0, Math.min(size - 1, (u + 1) * size / 2 - .5)), sy = Math.max(0, Math.min(size - 1, (v + 1) * size / 2 - .5));
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
        const alpha = (xx: number, yy: number) => input[(yy * size + xx) * 4 + 3];
        const at = (y * size + x) * 4;
        data[at] = 209; data[at + 1] = 25; data[at + 2] = 32;
        data[at + 3] = Math.round((alpha(x0, y0) * (1 - fx) + alpha(x1, y0) * fx) * (1 - fy) + (alpha(x0, y1) * (1 - fx) + alpha(x1, y1) * fx) * fy);
    }
    context.putImageData(output, 0, 0); return canvas;
}

function marker(context: CanvasRenderingContext2D, style: string) {
    context.save(); context.translate(210, 63); context.beginPath();
    if (style === "company-star") {
        for (let i = 0; i < 10; i++) { const angle = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? 6 : 14; const x = radius * Math.cos(angle), y = radius * Math.sin(angle); if (i) context.lineTo(x, y); else context.moveTo(x, y); }
    } else if (style === "company-diamond") { context.moveTo(0, -14); context.lineTo(12, 0); context.lineTo(0, 14); context.lineTo(-12, 0); }
    else if (style === "company-triangle") { context.moveTo(0, -14); context.lineTo(13, 11); context.lineTo(-13, 11); }
    else context.arc(0, 0, 11, 0, Math.PI * 2);
    context.closePath(); context.fill(); context.restore();
}

export async function renderSeal(rawName: string, style: string, options: SealOptions = { category: "personal", font: "doan", centerText: "대표이사" }) {
    const company = options.category === "company";
    const styles = company ? COMPANY_SEAL_STYLES : PERSONAL_SEAL_STYLES;
    if (!styles.some(item => item.id === style)) throw new Error("도장 모양을 다시 선택해 주세요.");
    if (!SEAL_FONTS.some(item => item.id === options.font)) throw new Error("도장 서체를 다시 선택해 주세요.");
    const name = company ? normalizeCompanySealName(rawName) : normalizeMarkName(rawName, "seal");
    const centerText = company ? normalizeSealCenter(options.centerText) : "";
    requireSealCharacters(name + centerText);
    const family = await loadMarkFont(options.font);
    const hanja = [...name + centerText].some(char => sealCharacterScript(char) === "hanja") ? await loadHanjaSealFont([...name + centerText].filter(char => sealCharacterScript(char) === "hanja").join("")) : undefined;
    const oval = style === "slender-oval", square = style.includes("square") || style === "company-inverse";
    const inverse = style.includes("intaglio") || style.includes("inverse") || style === "solid-round";
    const { canvas, context } = canvasContext(420, oval ? 560 : 420);
    const cx = 210, cy = canvas.height / 2;
    context.fillStyle = context.strokeStyle = INK; context.lineJoin = "round";
    const character = (target: CanvasRenderingContext2D, char: string, x: number, y: number, width: number, height: number) => {
        target.fillStyle = target.strokeStyle = INK;
        const chinese = sealCharacterScript(char) === "hanja";
        fitText(target, char, chinese ? hanja! : family, x, y, width, height, true, chinese ? { doan: 4.2, jeonseo: 0, gilsang: 2 }[options.font] : 0);
    };
    const grid = (target: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number, columns: number) => {
        const chars = [...text], rows = Math.ceil(chars.length / columns);
        chars.forEach((char, index) => {
            const column = Math.floor(index / rows), row = index % rows, inColumn = Math.min(rows, chars.length - column * rows), cellW = width / columns, cellH = height / rows;
            character(target, char, x + width / 2 - (column + .5) * cellW, y - height / 2 + (row + .5 + (rows - inColumn) / 2) * cellH, cellW * .94, cellH * .94);
        });
    };
    const roundGrid = (text: string, width: number, height: number, columns: number) => {
        const draft = canvasContext(344, 344);
        grid(draft.context, text, 172, 172, 326, 326, columns);
        context.drawImage(roundLettering(draft.canvas), cx - width / 2, cy - height / 2, width, height);
    };
    if (square) {
        context.lineWidth = 8; context.beginPath(); context.roundRect(23, 23, 374, 374, 5);
        if (inverse) { context.fill(); context.globalCompositeOperation = "destination-out"; context.lineWidth = 3; context.strokeRect(34, 34, 352, 352); }
        else context.stroke();
        if (company) {
            grid(context, name, cx, 173, 330, 244, Math.max(2, Math.ceil(Math.sqrt([...name].length))));
            context.lineWidth = 3; context.beginPath(); context.moveTo(43, 311); context.lineTo(377, 311); context.stroke();
            [...centerText].forEach((char, index, all) => { const cell = Math.min(65, 330 / all.length); character(context, char, cx + (index - (all.length - 1) / 2) * cell, 349, cell * .91, 49); });
        } else {
            const cells = sealCells(name); grid(context, cells.map(cell => cell.character).join(""), cx, cy, 334, 334, cells[0].columns);
        }
    } else if (company) {
        circle(context, cx, cy, 187, 7); circle(context, cx, cy, 113, 3);
        marker(context, style);
        const chars = [...name], arc = Math.PI * 1.86, width = Math.min(91, 147 * arc / chars.length * .84);
        chars.forEach((char, index) => {
            const angle = -Math.PI / 2 + (Math.PI * 2 - arc) / 2 + arc * (index + .5) / chars.length;
            context.save(); context.translate(cx + 147 * Math.cos(angle), cy + 147 * Math.sin(angle)); context.rotate(angle + Math.PI / 2);
            character(context, char, 0, 0, width, 54); context.restore();
        });
        roundGrid(centerText, 211, 211, [...centerText].length <= 3 ? 1 : 2);
    } else {
        if (oval) { context.lineWidth = 8; context.beginPath(); context.ellipse(cx, cy, 152, 251, 0, 0, Math.PI * 2); context.stroke(); }
        else {
            circle(context, cx, cy, 187, 7, inverse);
            if (inverse) { context.globalCompositeOperation = "destination-out"; circle(context, cx, cy, 176, 3); }
            else if (style === "classic-round") circle(context, cx, cy, 176, 2.5);
        }
        const cells = sealCells(name, oval);
        roundGrid(cells.map(cell => cell.character).join(""), oval ? 283 : 348, oval ? 477 : 348, cells[0].columns);
    }
    return trimmedPng(canvas);
}
