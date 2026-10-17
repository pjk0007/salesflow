/** A rectangle in the unrotated PDF user space (bottom-left origin). */
export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfRotation = 0 | 90 | 180 | 270;

/** width/height match a PDF.js viewport at scale 1, after page rotation. */
export interface PdfPage {
  pageIndex: number;
  width: number;
  height: number;
  rotation: PdfRotation;
  /** The effective visible CropBox, intersected with the MediaBox. */
  crop: PdfBox;
}

export interface PdfInspection {
  sha256: string;
  size: number;
  pageCount: number;
  pages: PdfPage[];
}

/** Ratios relative to the visible, rotated page; origin is its top-left. */
export interface NormalizedPdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfImagePlacement extends NormalizedPdfRect {
  pageIndex: number;
  /** A rendered signature, seal or text. The server does not require fonts. */
  png: Uint8Array;
}

export const ESIGN_PDF_LIMITS = {
  bytes: 10 * 1024 * 1024,
  pages: 30,
  pageDimension: 14_400,
  placements: 150,
  pngBytes: 1024 * 1024,
  pngDimension: 4096,
  pngPixels: 2_000_000,
  totalPngBytes: 8 * 1024 * 1024,
  totalPngPixels: 8_000_000,
  completedBytes: 25 * 1024 * 1024,
} as const;
