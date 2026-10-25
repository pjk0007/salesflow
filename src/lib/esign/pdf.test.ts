import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { degrees, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { completePdf, ESIGN_PDF_LIMITS, inspectPdf, validateSignaturePng } from "./pdf";

// Pillow-generated RGBA PNG: red/green/blue/black quadrants distinguish rotation.
const QUADRANT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJklEQVR4nGP8z8Dwn4GBgYFxC4hkYGCCUAjAyMDwH6xCUlIKuwoA8JQFBIK0JaYAAAAASUVORK5CYII=", "base64");

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, out.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}

function png(options: { width?: number; height?: number; color?: number; depth?: number; raw?: Buffer; palette?: Buffer; transparency?: Buffer; interlace?: number } = {}): Buffer {
  const { width = 2, height = 1, color = 6, depth = 8 } = options;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = depth; header[9] = color; header[12] = options.interlace ?? 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    ...(options.palette ? [chunk("PLTE", options.palette)] : []),
    ...(options.transparency ? [chunk("tRNS", options.transparency)] : []),
    chunk("IDAT", deflateSync(options.raw ?? Buffer.from([0, 0, 0, 0, 255, 0, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function sourcePdf(count = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) {
    const page = document.addPage([500 + index * 10, 700 + index * 20]);
    page.setCropBox(20 + index, 30 + index, 400, 600);
    page.setRotation(degrees((index % 4) * 90));
    page.drawText(`Original page ${index + 1}`, { x: 50, y: 550, size: 14 });
  }
  return document.save();
}

test("inspection parses true page geometry/hash for rotations and varying MediaBox sizes", async () => {
  const bytes = await sourcePdf(4);
  const metadata = await inspectPdf(bytes);
  assert.equal(metadata.size, bytes.length);
  assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(metadata.pageCount, 4);
  for (const [index, page] of metadata.pages.entries()) {
    assert.deepEqual(page.crop, { x: 20 + index, y: 30 + index, width: 400, height: 600 });
    assert.equal(page.rotation, index * 90);
    assert.equal(page.width, index % 2 ? 600 : 400);
    assert.equal(page.height, index % 2 ? 400 : 600);
  }
});

test("inspection uses the MediaBox intersection rather than an overflowing CropBox", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  page.setCropBox(-20, 30, 500, 700);
  page.setRotation(degrees(90));
  const result = (await inspectPdf(await document.save())).pages[0];
  assert.deepEqual(result.crop, { x: 0, y: 30, width: 400, height: 570 });
  assert.equal(result.width, 570); assert.equal(result.height, 400);
});

test("empty, disguised, truncated and over-limit PDFs are rejected", async () => {
  await assert.rejects(inspectPdf(new Uint8Array()), /10MB/);
  await assert.rejects(inspectPdf(Buffer.from("fake.pdf")), /올바른 PDF/);
  await assert.rejects(inspectPdf(Buffer.from("%PDF-1.7\nnot a PDF\n%%EOF")), /읽을 수 없습니다/);
  const valid = await sourcePdf();
  await assert.rejects(inspectPdf(valid.subarray(0, valid.length - 20)), /올바른 PDF/);
  await assert.rejects(inspectPdf(new Uint8Array(ESIGN_PDF_LIMITS.bytes + 1)), /10MB/);
  const empty = await PDFDocument.create();
  await assert.rejects(inspectPdf(await empty.save({ addDefaultPage: false })), /1~30/);
  await assert.rejects(inspectPdf(await sourcePdf(31)), /1~30/);
});

test("encryption marker, unsupported rotation and nonstandard UserUnit are rejected", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  page.node.set(PDFName.of("Rotate"), PDFNumber.of(45));
  await assert.rejects(inspectPdf(await document.save()), /90도/);
  page.setRotation(degrees(0));
  page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  await assert.rejects(inspectPdf(await document.save()), /배율/);
  page.node.delete(PDFName.of("UserUnit"));
  document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({ Filter: "Standard", V: 2, R: 3, Length: 128 }) as PDFDict);
  await assert.rejects(inspectPdf(await document.save()), (e: Error) => /^암호화된 PDF/.test(e.message) && /권한 제한/.test(e.message) && !/손상/.test(e.message));
});

test("UX-263: 손상·비표준 PDF는 암호 해제를 요구하지 않는 별도 문구이고, 정상 PDF는 그대로 통과한다", async () => {
  await assert.rejects(inspectPdf(Buffer.from("%PDF-1.7\nnot a PDF\n%%EOF")), (e: Error) => /손상되었거나 지원하지 않는/.test(e.message) && !/암호/.test(e.message));
  assert.equal((await inspectPdf(await sourcePdf())).pageCount, 1);
});

test("PNG validation decodes real filters and supports packed palette, RGB and 16-bit grayscale", () => {
  assert.deepEqual(validateSignaturePng(QUADRANT_PNG), { width: 4, height: 4 });
  assert.deepEqual(validateSignaturePng(png({ color: 2, raw: Buffer.from([0, 255, 0, 0, 0, 0, 255]) })), { width: 2, height: 1 });
  assert.deepEqual(validateSignaturePng(png({ color: 0, depth: 16, raw: Buffer.from([0, 0, 0, 255, 255]) })), { width: 2, height: 1 });
  assert.deepEqual(validateSignaturePng(png({ color: 3, depth: 1, palette: Buffer.from([0, 0, 0, 255, 255, 255]), raw: Buffer.from([0, 0b01000000]) })), { width: 2, height: 1 });
});

test("empty pixels, bad CRC, wrong format and malformed PNG streams are rejected", () => {
  assert.throws(() => validateSignaturePng(png({ raw: Buffer.from([0, 0, 0, 0, 0, 255, 255, 255, 0]) })), /비어/);
  assert.throws(() => validateSignaturePng(png({ raw: Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255]) })), /비어/);
  const corrupt = Buffer.from(QUADRANT_PNG); corrupt[45] ^= 1;
  assert.throws(() => validateSignaturePng(corrupt), /읽을 수 없습니다/);
  assert.throws(() => validateSignaturePng(Buffer.alloc(80)), /읽을 수 없습니다/);
  assert.throws(() => validateSignaturePng(png({ raw: Buffer.alloc(10_000) })), /읽을 수 없습니다/);
  assert.throws(() => validateSignaturePng(png({ raw: Buffer.from([5, 0, 0, 0, 255, 0, 0, 0, 255]) })), /읽을 수 없습니다/);
  assert.throws(() => validateSignaturePng(png({ interlace: 1 })), /인터레이스/);
  assert.throws(() => validateSignaturePng(png({ width: 4097 })), /4096px/);
  assert.throws(() => validateSignaturePng(png({ width: 2000, height: 2000 })), /200만/);
  assert.throws(() => validateSignaturePng(new Uint8Array(ESIGN_PDF_LIMITS.pngBytes + 1)), /1MB/);
  assert.throws(() => validateSignaturePng(png({ color: 3, palette: Buffer.from([0, 0, 0]), raw: Buffer.from([0, 1, 1]) })), /읽을 수 없습니다/);
});

test("composition produces a separately parseable PDF and leaves source bytes/geometry untouched", async () => {
  const original = await sourcePdf(4);
  const snapshot = Buffer.from(original);
  const placements = Array.from({ length: 4 }, (_, pageIndex) => ({ pageIndex, x: 0.1, y: 0.2, width: 0.3, height: 0.1, png: QUADRANT_PNG }));
  const completed = await completePdf(original, placements);
  assert.deepEqual(Buffer.from(original), snapshot);
  assert.notDeepEqual(completed, original);
  const before = await inspectPdf(original), after = await inspectPdf(completed);
  assert.notEqual(before.sha256, after.sha256);
  assert.deepEqual(after.pages, before.pages);
  const parsed = await PDFDocument.load(completed);
  for (const page of parsed.getPages()) {
    const images = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    assert.equal(images?.keys().length, 1, "each page receives the signature image");
  }
});

test("composition rejects missing pages, out-of-page boxes and unusable images before saving", async () => {
  const original = await sourcePdf();
  const valid = { pageIndex: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.1, png: QUADRANT_PNG };
  await assert.rejects(completePdf(original, []), /1~150/);
  await assert.rejects(completePdf(original, Array(151).fill(valid)), /1~150/);
  await assert.rejects(completePdf(original, [{ ...valid, pageIndex: 1 }]), /페이지/);
  await assert.rejects(completePdf(original, [{ ...valid, pageIndex: 0.5 }]), /페이지/);
  await assert.rejects(completePdf(original, [{ ...valid, x: 0.9 }]), /페이지 안/);
  await assert.rejects(completePdf(original, [{ ...valid, png: png({ raw: Buffer.alloc(9) }) }]), /비어/);
});

test("aggregate decoded image budget is enforced before embedding and repeated images are reused", async () => {
  const original = await sourcePdf();
  const placements = Array.from({ length: 5 }, (_, index) => {
    const raw = Buffer.alloc(1000 * (2000 * 4 + 1));
    for (let y = 0; y < 1000; y++) {
      for (let x = 0; x < 2000; x++) {
        const offset = y * 8001 + 1 + x * 4;
        raw[offset] = index * 20; raw[offset + 3] = 255;
      }
    }
    return { pageIndex: 0, x: 0.1, y: 0.2, width: 0.1, height: 0.1, png: png({ width: 2000, height: 1000, raw }) };
  });
  await assert.rejects(completePdf(original, placements), /전체 크기/);
  const repeated = await completePdf(original, Array(5).fill(placements[0]));
  const parsed = await PDFDocument.load(repeated);
  const images = parsed.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  // PDF page draws may assign multiple names but every name points to one image object.
  const references = images?.keys().map(key => images.get(key)?.toString());
  assert.equal(new Set(references).size, 1);
});
