/**
 * 전사본 문서 파일 → 글 (브라우저에서 읽는다, 서버로 파일을 보내지 않는다)
 * txt·md·srt·vtt·csv / docx / pdf
 */

const TEXT_EXT = /\.(txt|md|srt|vtt|csv|log)$/i;

export const isTranscriptDocument = (file: File) =>
    TEXT_EXT.test(file.name) || /\.docx$/i.test(file.name) || /\.pdf$/i.test(file.name) || file.type === "application/pdf" || file.type.startsWith("text/");

export async function readTranscriptFile(file: File): Promise<string> {
    const name = file.name.toLowerCase();
    if (name.endsWith(".docx")) return readDocx(file);
    if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdf(file);
    return readText(file);
}

/** 글 파일 — UTF-8이 깨지면 한글 윈도우 인코딩(EUC-KR)으로 다시 */
async function readText(file: File) {
    const buf = await file.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buf);
    if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
    try {
        return new TextDecoder("euc-kr").decode(buf);
    } catch {
        return utf8;
    }
}

/** docx = zip 안의 word/document.xml — 브라우저 내장 압축 풀기로 읽는다 */
async function readDocx(file: File) {
    const xml = await unzipEntry(new Uint8Array(await file.arrayBuffer()), "word/document.xml");
    if (!xml) throw new Error("docx 내용을 찾지 못했어요.");
    return xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function unzipEntry(bytes: Uint8Array, entryName: string): Promise<string | null> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 끝에서 중앙 디렉터리 끝(EOCD) 찾기
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const local = view.getUint32(p + 42, true);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        if (name === entryName) {
            const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
            const data = bytes.subarray(start, start + compSize);
            if (method === 0) return dec.decode(data);
            if (method !== 8) return null;
            const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            return new Response(stream).text();
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
}

/** pdf — 전자서명과 같은 pdfjs로 페이지마다 글만 뽑는다 (한글 글꼴 표는 같은 경로) */
async function readPdf(file: File) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const assets = `/api/esign/assets/${pdfjs.version}`;
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        cMapUrl: `${assets}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assets}/standard_fonts/`,
        wasmUrl: `${assets}/wasm/`,
    }).promise;
    try {
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const content = await (await doc.getPage(i)).getTextContent();
            let line = "";
            const lines: string[] = [];
            for (const item of content.items) {
                if (!("str" in item)) continue;
                line += item.str;
                if (item.hasEOL) {
                    lines.push(line);
                    line = "";
                }
            }
            if (line) lines.push(line);
            pages.push(lines.join("\n"));
        }
        return pages.join("\n\n").trim();
    } finally {
        void doc.cleanup();
    }
}
