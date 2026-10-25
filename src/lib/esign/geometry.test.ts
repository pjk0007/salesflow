import assert from "node:assert/strict";
import test from "node:test";
import { fieldRasterSize, normalizePdfRotation, pdfImageTransform, validateNormalizedPdfRect, visiblePdfCrop } from "./geometry";
import type { PdfPage } from "./pdf-types";

test("CropBox is clipped to the MediaBox while retaining a nonzero origin", () => {
  assert.deepEqual(visiblePdfCrop({ x: -10, y: 20, width: 300, height: 500 }, { x: 30, y: 40, width: 500, height: 400 }),
    { x: 30, y: 40, width: 260, height: 400 });
  assert.throws(() => visiblePdfCrop({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }));
});

test("quarter-turn placement origins include crop offsets and preserve upright image sizes", () => {
  const common = { pageIndex: 0, crop: { x: 20, y: 30, width: 400, height: 600 } };
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const expected = [
    { x: 60, y: 450, width: 120, height: 60, rotation: 0 },
    { x: 140, y: 90, width: 180, height: 40, rotation: 90 },
    { x: 380, y: 210, width: 120, height: 60, rotation: 180 },
    { x: 300, y: 570, width: 180, height: 40, rotation: 270 },
  ];
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    const page: PdfPage = { ...common, rotation, width: rotation % 180 ? 600 : 400, height: rotation % 180 ? 400 : 600 };
    assert.deepEqual(pdfImageTransform(page, rect), expected[index]);
  }
});

test("only finite positive boxes inside the visible page can be composed", () => {
  for (const rect of [
    { x: -0.01, y: 0, width: 0.1, height: 0.1 },
    { x: 0.9, y: 0.9, width: 0.2, height: 0.2 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Infinity, width: 1, height: 1 },
  ]) assert.throws(() => validateNormalizedPdfRect(rect));
  validateNormalizedPdfRect({ x: 0, y: 0, width: 1, height: 1 });
  assert.equal(normalizePdfRotation(-90), 270);
  assert.equal(normalizePdfRotation(450), 90);
  assert.throws(() => normalizePdfRotation(45));
  assert.throws(() => normalizePdfRotation(Infinity));
});

test("UX-189 입력란 이미지 크기는 고객 화면과 같은 산식이며 31/32픽셀 경계에서 갈린다", () => {
  const square = { width: 1, height: 1 };
  // 세로로 가는 칸: sqrt(80000·a)가 32 이상이어야 한다.
  assert.equal(fieldRasterSize({ width: 0.0129, height: 1 }, square).width, 32);
  assert.equal(fieldRasterSize({ width: 0.0129, height: 1 }, square).usable, true);
  assert.equal(fieldRasterSize({ width: 0.0127, height: 1 }, square).width, 31);
  assert.equal(fieldRasterSize({ width: 0.0127, height: 1 }, square).usable, false);
  // 가로로 납작한 칸: 너비 600 고정, 높이 floor(600/a)가 32 이상이어야 한다.
  assert.deepEqual(fieldRasterSize({ width: 18.75, height: 1 }, square), { aspect: 18.75, width: 600, height: 32, usable: true });
  assert.equal(fieldRasterSize({ width: 18.8, height: 1 }, square).height, 31);
  assert.equal(fieldRasterSize({ width: 18.8, height: 1 }, square).usable, false);
  // A4 세로에서 너비 100%·높이 2%(작성 화면 최소값) 서명란은 막히고, 기본 서명란(20%·7%)은 허용된다.
  const a4 = { width: 595, height: 842 }, a4Landscape = { width: 842, height: 595 };
  assert.equal(fieldRasterSize(a4, { width: 1, height: 0.02 }).usable, false);
  assert.equal(fieldRasterSize(a4, { width: 0.2, height: 0.07 }).usable, true);
  assert.equal(fieldRasterSize(a4Landscape, { width: 0.2, height: 0.07 }).usable, true);
  assert.equal(fieldRasterSize(a4Landscape, { width: 0.02, height: 1 }).usable, true);
  assert.equal(fieldRasterSize(a4, { width: 0, height: 0.1 }).usable, false);
});
