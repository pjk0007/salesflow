import assert from "node:assert/strict";
import test from "node:test";
import { normalizePdfRotation, pdfImageTransform, validateNormalizedPdfRect, visiblePdfCrop } from "./geometry";
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
