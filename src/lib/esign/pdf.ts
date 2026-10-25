import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { degrees, EncryptedPDFError, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { normalizePdfRotation, pdfImageTransform, visiblePdfCrop } from "./geometry";
import { ESIGN_PDF_LIMITS, type PdfImagePlacement, type PdfInspection, type PdfPage } from "./pdf-types";
export { ESIGN_PDF_LIMITS } from "./pdf-types";

const ENCRYPTED_PDF_MESSAGE = "암호화된 PDF(열기 암호·인쇄/편집 권한 제한 포함)는 사용할 수 없습니다. 제한을 해제한 뒤 PDF로 다시 저장해 주세요.";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function readPdf(bytes: Uint8Array): Promise<{ document: PDFDocument; inspection: PdfInspection }> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > ESIGN_PDF_LIMITS.bytes) {
    throw new Error("PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.");
  }
  const header = Buffer.from(bytes.subarray(0, 8)).toString("ascii");
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString("latin1");
  if (!/^%PDF-(?:1\.[0-7]|2\.0)/.test(header) || !/%%EOF\s*$/.test(tail)) {
    throw new Error("올바른 PDF 파일이 아닙니다. PDF로 다시 저장해 주세요.");
  }
  let document: PDFDocument;
  let sourcePages: ReturnType<PDFDocument["getPages"]>;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    sourcePages = document.getPages();
  } catch (error) {
    // UX-263: 암호·권한 제한과 손상·비표준 파일을 다른 문구로 안내한다(파싱 기준은 완료 PDF와 같아 완화하지 않는다).
    // pdf-lib의 EncryptedPDFError는 ES5 상속이라 instanceof가 실패할 수 있어 문구·트레일러 표시도 함께 본다.
    if (error instanceof EncryptedPDFError || (error instanceof Error && /\bis encrypted\b/.test(error.message)) || /\/Encrypt\b/.test(tail)) throw new Error(ENCRYPTED_PDF_MESSAGE);
    throw new Error("PDF를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다. 원본 프로그램에서 PDF로 다시 저장해 주세요.");
  }
  if (document.isEncrypted) throw new Error(ENCRYPTED_PDF_MESSAGE);
  const count = sourcePages.length;
  if (count < 1 || count > ESIGN_PDF_LIMITS.pages) {
    throw new Error("PDF는 1~30페이지여야 합니다.");
  }
  const pages: PdfPage[] = sourcePages.map((page, pageIndex) => {
    let unit: number, media: ReturnType<typeof page.getMediaBox>, pageCrop: ReturnType<typeof page.getCropBox>, angle: number;
    try {
      unit = page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() ?? 1;
      media = page.getMediaBox(); pageCrop = page.getCropBox(); angle = page.getRotation().angle;
    } catch {
      throw new Error("PDF 페이지를 읽을 수 없습니다. 정상 PDF로 다시 저장해 주세요.");
    }
    if (unit !== 1) throw new Error("배율이 특수하게 지정된 PDF는 표준 PDF로 다시 저장해 주세요.");
    const crop = visiblePdfCrop(media, pageCrop);
    const rotation = normalizePdfRotation(angle);
    const width = rotation % 180 === 0 ? crop.width : crop.height;
    const height = rotation % 180 === 0 ? crop.height : crop.width;
    if (Math.max(width, height) > ESIGN_PDF_LIMITS.pageDimension) {
      throw new Error("PDF 페이지 크기가 너무 큽니다. 표준 용지 크기로 다시 저장해 주세요.");
    }
    return { pageIndex, width, height, rotation, crop };
  });
  return { document, inspection: { sha256: sha256(bytes), size: bytes.length, pageCount: count, pages } };
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  return (await readPdf(bytes)).inspection;
}

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function invalidPng(): never {
  throw new Error("서명 이미지를 읽을 수 없습니다. PNG로 다시 저장해 주세요.");
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode bounded PNG scanlines before passing them to the PDF library. This
 * checks actual compressed pixels, CRCs and visible ink, not just a MIME type
 * or IHDR. Browser canvases emit the supported noninterlaced PNG format.
 */
function decodeSignaturePng(bytes: Uint8Array, pixelBudget: number): { width: number; height: number } {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > ESIGN_PDF_LIMITS.pngBytes) {
    throw new Error("서명 PNG는 비어 있지 않은 1MB 이하 파일이어야 합니다.");
  }
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) invalidPng();
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, width = 0, height = 0, depth = 0, color = -1;
  let palette: Buffer | undefined, transparency: Buffer | undefined;
  let sawData = false, dataEnded = false, sawEnd = false;
  const compressed: Buffer[] = [];
  while (offset < source.length) {
    if (offset + 12 > source.length) invalidPng();
    const length = source.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > source.length) invalidPng();
    const type = source.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || source.readUInt32BE(end - 4) !== crc32(source.subarray(offset + 4, end - 4))) invalidPng();
    const data = source.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== "IHDR") invalidPng();
    if (sawData && type !== "IDAT") dataEnded = true;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) invalidPng();
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0) invalidPng();
      if (data[12] !== 0) throw new Error("인터레이스 PNG는 일반 PNG로 다시 저장해 주세요.");
      if (!width || !height || Math.max(width, height) > ESIGN_PDF_LIMITS.pngDimension || width * height > ESIGN_PDF_LIMITS.pngPixels) {
        throw new Error("서명 이미지는 가로·세로 4096px, 총 200만 픽셀 이하여야 합니다.");
      }
      if (width * height > pixelBudget) throw new Error("서명 이미지의 전체 크기가 너무 큽니다. 이미지 크기를 줄여 주세요.");
    } else if (type === "PLTE") {
      if (sawData || palette || !length || length % 3 || length > 768 || color === 0 || color === 4) invalidPng();
      palette = data;
    } else if (type === "tRNS") {
      if (sawData || transparency || (color === 0 && length !== 2) || (color === 2 && length !== 6)
        || (color === 3 && (!palette || length > palette.length / 3)) || color === 4 || color === 6) invalidPng();
      transparency = data;
    } else if (type === "IDAT") {
      if (dataEnded || (color === 3 && !palette)) invalidPng();
      compressed.push(data); sawData = true;
    } else if (type === "IEND") {
      if (length || !sawData || end !== source.length) invalidPng();
      sawEnd = true;
    } else if (/^[A-Z]/.test(type) || ["acTL", "fcTL", "fdAT"].includes(type)) {
      invalidPng();
    }
    offset = end;
  }
  if (!sawEnd || !compressed.length || (color === 3 && (!palette || palette.length / 3 > 2 ** depth))) invalidPng();
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  const rowBytes = Math.ceil(width * channels * depth / 8);
  const bpp = Math.max(1, Math.ceil(channels * depth / 8));
  const expected = height * (rowBytes + 1);
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { invalidPng(); }
  if (decoded.length !== expected) invalidPng();
  let previous = Buffer.alloc(rowBytes);
  let hasInk = false;
  const maxSample = 2 ** depth - 1;
  for (let y = 0; y < height; y++) {
    const filter = decoded[y * (rowBytes + 1)];
    if (filter > 4) invalidPng();
    const row = Buffer.from(decoded.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = previous[i];
      const corner = i >= bpp ? previous[i - bpp] : 0;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0;
      row[i] = (row[i] + predictor) & 0xff;
    }
    const sample = (index: number): number => depth === 16 ? row.readUInt16BE(index * 2)
      : depth === 8 ? row[index] : (row[Math.floor(index * depth / 8)] >>> (8 - depth - ((index * depth) % 8))) & maxSample;
    for (let x = 0; x < width; x++) {
      const base = x * channels;
      let red: number, green: number, blue: number, alpha = 255;
      if (color === 3) {
        const index = sample(base);
        if (!palette || index * 3 + 2 >= palette.length) invalidPng();
        red = palette[index * 3]; green = palette[index * 3 + 1]; blue = palette[index * 3 + 2];
        alpha = transparency?.[index] ?? 255;
      } else if (color === 0 || color === 4) {
        const gray = sample(base);
        red = green = blue = gray * 255 / maxSample;
        if (color === 4) alpha = sample(base + 1) * 255 / maxSample;
        else if (transparency && gray === transparency.readUInt16BE(0)) alpha = 0;
      } else {
        const r = sample(base), g = sample(base + 1), b = sample(base + 2);
        red = r * 255 / maxSample; green = g * 255 / maxSample; blue = b * 255 / maxSample;
        if (color === 6) alpha = sample(base + 3) * 255 / maxSample;
        else if (transparency && r === transparency.readUInt16BE(0) && g === transparency.readUInt16BE(2) && b === transparency.readUInt16BE(4)) alpha = 0;
      }
      if (alpha >= 16 && Math.min(red, green, blue) < 245) hasInk = true;
    }
    previous = row;
  }
  if (!hasInk) throw new Error("서명 이미지가 비어 있습니다. 서명이나 도장을 입력해 주세요.");
  return { width, height };
}

export function validateSignaturePng(bytes: Uint8Array): { width: number; height: number } {
  return decodeSignaturePng(bytes, ESIGN_PDF_LIMITS.pngPixels);
}

export async function completePdf(original: Uint8Array, placements: PdfImagePlacement[]): Promise<Uint8Array> {
  if (!Array.isArray(placements) || placements.length < 1 || placements.length > ESIGN_PDF_LIMITS.placements) {
    throw new Error("서명 입력란은 1~150개여야 합니다.");
  }
  const { document, inspection } = await readPdf(original);
  const unique = new Map<string, { bytes: Uint8Array; width: number; height: number }>();
  let totalBytes = 0, totalPixels = 0;
  const prepared = placements.map((placement) => {
    if (!placement || !(placement.png instanceof Uint8Array)) {
      throw new Error("서명 PNG 이미지가 필요합니다.");
    }
    if (!Number.isInteger(placement.pageIndex) || placement.pageIndex < 0 || placement.pageIndex >= inspection.pageCount) {
      throw new Error("입력란의 PDF 페이지가 올바르지 않습니다.");
    }
    const transform = pdfImageTransform(inspection.pages[placement.pageIndex], placement);
    if (placement.png.length > ESIGN_PDF_LIMITS.pngBytes) throw new Error("서명 PNG는 1MB 이하 파일이어야 합니다.");
    const hash = sha256(placement.png);
    if (!unique.has(hash)) {
      totalBytes += placement.png.length;
      if (totalBytes > ESIGN_PDF_LIMITS.totalPngBytes) throw new Error("서명 이미지의 전체 크기가 너무 큽니다. 이미지 크기를 줄여 주세요.");
      const metadata = decodeSignaturePng(placement.png, ESIGN_PDF_LIMITS.totalPngPixels - totalPixels);
      totalPixels += metadata.width * metadata.height;
      unique.set(hash, { bytes: placement.png, ...metadata });
    }
    return { pageIndex: placement.pageIndex, transform, hash };
  });
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const [hash, image] of unique) embedded.set(hash, await document.embedPng(image.bytes));
  for (const { pageIndex, transform, hash } of prepared) {
    const { x, y, width, height, rotation } = transform;
    document.getPage(pageIndex).drawImage(embedded.get(hash)!, { x, y, width, height, rotate: degrees(rotation) });
  }
  const completed = await document.save({ useObjectStreams: true, addDefaultPage: false });
  if (completed.length > ESIGN_PDF_LIMITS.completedBytes) throw new Error("완료 PDF 크기가 한도를 초과했습니다.");
  return completed;
}
