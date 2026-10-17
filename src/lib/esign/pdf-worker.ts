import path from "node:path";
import { access } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { ESIGN_PDF_LIMITS, type PdfImagePlacement, type PdfInspection } from "./pdf-types";
import { EsignError } from "./types";

const TASK_TIMEOUT_MS = 15_000;
const MAX_WAITING = 4;
const MAX_TRANSFER_BYTES = 26 * 1024 * 1024;
type Request = { kind: "inspect"; bytes: Uint8Array } | { kind: "complete"; bytes: Uint8Array; placements: PdfImagePlacement[] };
interface PendingTask { start: () => void; reject: (error: EsignError) => void; timer: ReturnType<typeof setTimeout> }
interface QueueState { active: boolean; waiting: PendingTask[] }
const shared = globalThis as typeof globalThis & { __sendbEsignPdfWorkerQueue?: QueueState };
const state = shared.__sendbEsignPdfWorkerQueue ??= { active: false, waiting: [] };

function unavailable(message: string, code: string) { return new EsignError(message, 503, code); }

function nextTask(): void {
  const next = state.waiting.shift();
  if (next) { clearTimeout(next.timer); next.start(); }
  else state.active = false;
}

function validateTransferSize(request: Request): void {
  if (!(request.bytes instanceof Uint8Array) || !request.bytes.length || request.bytes.length > ESIGN_PDF_LIMITS.bytes) {
    throw new EsignError("PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.");
  }
  if (request.kind === "complete") {
    if (!Array.isArray(request.placements) || !request.placements.length || request.placements.length > ESIGN_PDF_LIMITS.placements) {
      throw new EsignError("서명 입력란은 1~150개여야 합니다.");
    }
    let total = request.bytes.length;
    for (const placement of request.placements) {
      if (!placement || !(placement.png instanceof Uint8Array) || placement.png.length > ESIGN_PDF_LIMITS.pngBytes) {
        throw new EsignError("서명 PNG는 1MB 이하 파일이어야 합니다.");
      }
      total += placement.png.length;
      if (total > MAX_TRANSFER_BYTES) throw new EsignError("서명 처리 자료의 전체 크기가 너무 큽니다.", 413, "pdf_input_limit");
    }
  }
}

async function runWorker(request: Request): Promise<PdfInspection | Uint8Array> {
  const entry = path.join(process.cwd(), ".esign-runtime", "pdf-worker.cjs");
  try { await access(entry); } catch {
    throw unavailable("전자서명 PDF 처리기가 준비되지 않았습니다. 관리자에게 문의해 주세요.", "pdf_worker_unavailable");
  }
  const copy = (bytes: Uint8Array) => Uint8Array.from(bytes);
  const bytes = copy(request.bytes);
  const payload: Request = request.kind === "inspect" ? { kind: "inspect", bytes }
    : { kind: "complete", bytes, placements: request.placements.map(placement => ({ ...placement, png: copy(placement.png) })) };
  const transfer = [bytes.buffer, ...(payload.kind === "complete" ? payload.placements.map(placement => placement.png.buffer) : [])] as ArrayBuffer[];
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(entry, {
        workerData: payload, transferList: transfer, execArgv: [], env: {},
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch { reject(unavailable("전자서명 PDF 처리기를 시작할 수 없습니다.", "pdf_worker_start_failed")); return; }
    let settled = false;
    const finish = (error?: EsignError, result?: PdfInspection | Uint8Array) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      worker.removeAllListeners();
      // Keep an error listener until termination settles so a late worker failure
      // cannot become an uncaught error on the main process.
      worker.on("error", () => {});
      void worker.terminate().catch(() => {}).finally(() => {
        if (error) reject(error); else resolve(result!);
      });
    };
    const timer = setTimeout(() => finish(unavailable("PDF 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", "pdf_worker_timeout")), TASK_TIMEOUT_MS);
    worker.once("error", () => finish(unavailable("PDF 처리기가 중단되었습니다. 잠시 후 다시 시도해 주세요.", "pdf_worker_failed")));
    worker.once("exit", () => finish(unavailable("PDF 처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.", "pdf_worker_exit")));
    worker.once("message", (reply: unknown) => {
      if (!reply || typeof reply !== "object" || !("ok" in reply)) {
        finish(unavailable("PDF 처리 결과를 확인할 수 없습니다.", "pdf_worker_invalid_reply")); return;
      }
      const result = reply as { ok: boolean; result?: PdfInspection | Uint8Array; message?: string };
      if (!result.ok) {
        finish(new EsignError(typeof result.message === "string" ? result.message : "PDF를 처리할 수 없습니다.", 400, "pdf_invalid")); return;
      }
      if (request.kind === "complete" && (!(result.result instanceof Uint8Array) || !result.result.length || result.result.length > ESIGN_PDF_LIMITS.completedBytes)) {
        finish(unavailable("완료 PDF 결과를 확인할 수 없습니다.", "pdf_worker_invalid_reply")); return;
      }
      if (request.kind === "inspect" && (!result.result || result.result instanceof Uint8Array || !Array.isArray(result.result.pages))) {
        finish(unavailable("PDF 페이지 결과를 확인할 수 없습니다.", "pdf_worker_invalid_reply")); return;
      }
      finish(undefined, result.result);
    });
  });
}

function enqueue(request: Request): Promise<PdfInspection | Uint8Array> {
  validateTransferSize(request);
  return new Promise((resolve, reject) => {
    if (state.active && state.waiting.length >= MAX_WAITING) {
      reject(unavailable("PDF 처리 요청이 많습니다. 잠시 후 다시 시도해 주세요.", "pdf_worker_overloaded")); return;
    }
    const start = () => {
      state.active = true;
      void runWorker(request).then(resolve, reject).finally(nextTask);
    };
    if (!state.active) { start(); return; }
    const item: PendingTask = {
      start, reject,
      timer: setTimeout(() => {
        const index = state.waiting.indexOf(item);
        if (index !== -1) state.waiting.splice(index, 1);
        reject(unavailable("PDF 처리 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", "pdf_worker_queue_timeout"));
      }, TASK_TIMEOUT_MS),
    };
    state.waiting.push(item);
  });
}

export async function inspectPdfInWorker(bytes: Uint8Array): Promise<PdfInspection> {
  return await enqueue({ kind: "inspect", bytes }) as PdfInspection;
}

export async function completePdfInWorker(original: Uint8Array, placements: PdfImagePlacement[]): Promise<Uint8Array> {
  return await enqueue({ kind: "complete", bytes: original, placements }) as Uint8Array;
}
