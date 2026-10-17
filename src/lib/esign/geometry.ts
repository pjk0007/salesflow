import type { NormalizedPdfRect, PdfBox, PdfPage, PdfRotation } from "./pdf-types";

export function normalizePdfRotation(angle: number): PdfRotation {
  if (!Number.isFinite(angle) || angle % 90 !== 0) {
    throw new Error("PDF 페이지 회전은 90도 단위여야 합니다.");
  }
  return (((angle % 360) + 360) % 360) as PdfRotation;
}

function validateBox(box: PdfBox): void {
  if (!Object.values(box).every(Number.isFinite) || box.width <= 0 || box.height <= 0) {
    throw new Error("PDF 페이지 크기가 올바르지 않습니다.");
  }
}

export function visiblePdfCrop(media: PdfBox, crop: PdfBox): PdfBox {
  validateBox(media);
  validateBox(crop);
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  const visible = { x, y, width, height };
  validateBox(visible);
  return visible;
}

export function validateNormalizedPdfRect(rect: NormalizedPdfRect): void {
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite)
    || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
    throw new Error("입력란은 PDF 페이지 안에 배치해야 합니다.");
  }
}

/**
 * Convert an upright display rectangle into PDF drawing coordinates. The
 * origin returned here is the image's bottom-left, before its own rotation.
 * Rotating the image by the page's rotation cancels the viewer's page rotation
 * because PDF drawing is y-up while the display rectangle is y-down.
 */
export function pdfImageTransform(page: PdfPage, rect: NormalizedPdfRect): PdfBox & { rotation: PdfRotation } {
  validateNormalizedPdfRect(rect);
  validateBox(page.crop);
  const { x: cx, y: cy, width: cw, height: ch } = page.crop;
  const displayWidth = page.rotation % 180 === 0 ? cw : ch;
  const displayHeight = page.rotation % 180 === 0 ? ch : cw;
  const left = rect.x * displayWidth;
  const top = rect.y * displayHeight;
  const width = rect.width * displayWidth;
  const height = rect.height * displayHeight;
  switch (page.rotation) {
    case 0: return { x: cx + left, y: cy + ch - top - height, width, height, rotation: 0 };
    case 90: return { x: cx + top + height, y: cy + left, width, height, rotation: 90 };
    case 180: return { x: cx + cw - left, y: cy + top + height, width, height, rotation: 180 };
    case 270: return { x: cx + cw - top - height, y: cy + ch - left, width, height, rotation: 270 };
  }
}
