import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { degrees, PDFDocument, rgb } from "pdf-lib";
import { completePdf, inspectPdf } from "../src/lib/esign/pdf";

async function main() {
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output)) throw new Error("절대 경로의 격리 검수 폴더를 지정하세요.");
  await mkdir(output, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJklEQVR4nGP8z8Dwn4GBgYFxC4hkYGCCUAjAyMDwH6xCUlIKuwoA8JQFBIK0JaYAAAAASUVORK5CYII=", "base64");
  const document = await PDFDocument.create();
  const sizes = [[500, 700], [630, 500], [450, 680], [720, 520]];
  for (const [index, size] of sizes.entries()) {
    const page = document.addPage(size as [number, number]);
    const crop = { x: 20 + index * 5, y: 30 + index * 7, width: size[0] - 80 - index * 10, height: size[1] - 100 - index * 5 };
    page.setCropBox(crop.x, crop.y, crop.width, crop.height);
    page.setRotation(degrees(index * 90));
    page.drawRectangle({ ...crop, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 2 });
    page.drawText(`ORIGINAL PAGE ${index + 1} / ROTATION ${index * 90}`, { x: crop.x + 12, y: crop.y + crop.height / 2, size: 13 });
  }
  const original = await document.save();
  const originalSnapshot = Buffer.from(original);
  const inspection = await inspectPdf(original);
  const boxes = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.12 }, { x: 0.68, y: 0.7, width: 0.2, height: 0.16 }];
  const placements = inspection.pages.flatMap(({ pageIndex }) => boxes.map(box => ({ pageIndex, ...box, png })));
  const started = performance.now();
  const completed = await completePdf(original, placements);
  const elapsedMs = performance.now() - started;
  assert.deepEqual(Buffer.from(original), originalSnapshot);
  assert.deepEqual((await inspectPdf(completed)).pages, inspection.pages);
  await writeFile(path.join(output, "original.pdf"), original);
  await writeFile(path.join(output, "completed.pdf"), completed);
  await writeFile(path.join(output, "quadrant.png"), png);
  const large = await PDFDocument.create();
  for (let index = 0; index < 30; index++) large.addPage([500, 700]);
  const largeSource = await large.save();
  const many = Array.from({ length: 150 }, (_, index) => ({ pageIndex: index % 30, x: 0.1 + Math.floor(index / 30) * 0.15, y: 0.1, width: 0.1, height: 0.1, png }));
  const largeStarted = performance.now();
  const largeCompleted = await completePdf(largeSource, many);
  const largeElapsedMs = performance.now() - largeStarted;
  const manifest = {
    fixture: "generated-only; colored quadrants reveal orientation, no real customer data",
    inspection, boxes, elapsedMs, originalBytes: original.length, completedBytes: completed.length,
    sourceUnchanged: true,
    repeatedImageCase: { pages: 30, placements: 150, elapsedMs: largeElapsedMs, outputBytes: largeCompleted.length },
    processMaxRssKiB: process.resourceUsage().maxRSS,
    visualCheck: "pending independent rendering and pixel inspection",
  };
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ output, elapsedMs, repeatedImageElapsedMs: largeElapsedMs, sourceUnchanged: true }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
