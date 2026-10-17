import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { degrees, PDFDocument } from "pdf-lib";
import { completePdfInWorker, inspectPdfInWorker } from "./pdf-worker";
import { EsignError } from "./types";

const project = process.cwd();
const quadrant = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAJklEQVR4nGP8z8Dwn4GBgYFxC4hkYGCCUAjAyMDwH6xCUlIKuwoA8JQFBIK0JaYAAAAASUVORK5CYII=", "base64");

before(() => { execFileSync(process.execPath, [path.join(project, "scripts/build-esign-worker.cjs")], { cwd: project, stdio: "pipe" }); });

async function fixture() {
  const doc = await PDFDocument.create();
  for (let index = 0; index < 4; index++) {
    const page = doc.addPage([500 + index * 10, 700 + index * 20]);
    page.setCropBox(20, 30, 400, 600); page.setRotation(degrees(index * 90));
  }
  return doc.save();
}

async function isolatedBundle(source: string | undefined, work: () => Promise<void>) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "sendb-esign-worker-"));
  try {
    if (source !== undefined) {
      await mkdir(path.join(folder, ".esign-runtime"));
      await writeFile(path.join(folder, ".esign-runtime", "pdf-worker.cjs"), source);
    }
    process.chdir(folder);
    await work();
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally {
    process.chdir(project);
    // This resolved, freshly-created temp directory is the sole deletion target.
    const resolved = path.resolve(folder);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith("sendb-esign-worker-"));
    await rm(resolved, { recursive: true, force: true });
  }
}

const hasCode = (code: string) => (error: unknown) => error instanceof EsignError && error.status === 503 && error.code === code;

test("isolated real worker parses and completes rotated PDFs without detaching source bytes", async () => {
  const source = await fixture(), snapshot = Buffer.from(source);
  const before = await inspectPdfInWorker(source);
  assert.deepEqual(before.pages.map(page => [page.rotation, page.width, page.height]), [[0, 400, 600], [90, 600, 400], [180, 400, 600], [270, 600, 400]]);
  const completed = await completePdfInWorker(source, before.pages.map(page => ({ pageIndex: page.pageIndex, x: 0.1, y: 0.2, width: 0.2, height: 0.1, png: quadrant })));
  assert.deepEqual(Buffer.from(source), snapshot);
  assert.ok(quadrant.byteLength > 0);
  const after = await inspectPdfInWorker(completed);
  assert.deepEqual(after.pages, before.pages);
  assert.notEqual(after.sha256, before.sha256);
});

test("worker input failure returns a sanitized validation error and the next task still works", async () => {
  await assert.rejects(inspectPdfInWorker(Buffer.from("not a pdf")), (error: unknown) => error instanceof EsignError && error.status === 400 && error.code === "pdf_invalid");
  assert.equal((await inspectPdfInWorker(await fixture())).pageCount, 4);
});

test("missing bundle fails closed instead of parsing on the main process", async () => {
  await isolatedBundle(undefined, async () => {
    await assert.rejects(inspectPdfInWorker(Buffer.from("dummy")), hasCode("pdf_worker_unavailable"));
  });
});

test("worker exiting without a result cannot crash or strand the main process queue", async () => {
  await isolatedBundle("process.exit(12);", async () => {
    await assert.rejects(inspectPdfInWorker(Buffer.from("dummy")), hasCode("pdf_worker_exit"));
    await assert.rejects(inspectPdfInWorker(Buffer.from("dummy")), hasCode("pdf_worker_exit"));
  });
  assert.equal((await inspectPdfInWorker(await fixture())).pageCount, 4);
});

test("one running worker and four waiting tasks reject overload while main event loop remains responsive", async () => {
  await isolatedBundle("const end=Date.now()+150; while(Date.now()<end) {} process.exit(12);", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
      const pending = Array.from({ length: 5 }, () => inspectPdfInWorker(Buffer.from("dummy")));
      const settled = Promise.allSettled(pending);
      await assert.rejects(inspectPdfInWorker(Buffer.from("dummy")), hasCode("pdf_worker_overloaded"));
      const results = await settled;
      assert.ok(results.every(result => result.status === "rejected" && hasCode("pdf_worker_exit")(result.reason)));
      assert.ok(ticks >= 10, `main event loop must tick during worker work; got ${ticks}`);
    } finally { clearInterval(timer); }
  });
});

test("hung worker is terminated at the fixed 15 second deadline and capacity recovers", { timeout: 22_000 }, async () => {
  await isolatedBundle("setInterval(()=>{}, 1000);", async () => {
    const started = Date.now();
    await assert.rejects(inspectPdfInWorker(Buffer.from("dummy")), hasCode("pdf_worker_timeout"));
    assert.ok(Date.now() - started >= 14_500);
    assert.ok(Date.now() - started < 19_000);
  });
  assert.equal((await inspectPdfInWorker(await fixture())).pageCount, 4);
});
