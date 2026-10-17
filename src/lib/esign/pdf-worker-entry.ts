import { parentPort, workerData } from "node:worker_threads";
import { completePdf, inspectPdf } from "./pdf";
import type { PdfImagePlacement } from "./pdf-types";

async function main() {
  if (!parentPort) return;
  const request = workerData as { kind?: unknown; bytes: Uint8Array; placements?: PdfImagePlacement[] };
  try {
    if (request.kind === "inspect") parentPort.postMessage({ ok: true, result: await inspectPdf(request.bytes) });
    else if (request.kind === "complete" && Array.isArray(request.placements)) {
      const result = await completePdf(request.bytes, request.placements);
      parentPort.postMessage({ ok: true, result }, [result.buffer as ArrayBuffer]);
    } else parentPort.postMessage({ ok: false, message: "PDF 처리 요청이 올바르지 않습니다." });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const message = /^(?:PDF|올바른 PDF|암호화된 PDF|배율이|서명|입력란|인터레이스 PNG)/.test(raw) && raw.length < 200 && !/[\r\n]/.test(raw)
      ? raw : "PDF를 처리할 수 없습니다. 정상 파일로 다시 시도해 주세요.";
    parentPort.postMessage({ ok: false, message });
  }
}

void main();
