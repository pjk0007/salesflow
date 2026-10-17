import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { EsignService } from "../src/lib/esign/core";
import { PostgresEsignRepository, type EsignSql } from "../src/lib/esign/postgres-repository";
import { createEsignStorage, localEsignBlobStore } from "../src/lib/esign/storage";
import { createEsignJobRunner, processEsignJobs } from "../src/lib/esign/worker";
import type { EsignHttpDependencies } from "../src/lib/esign/http";
import { EsignError, type EsignActor, type EsignJob, type DeliveryPayload } from "../src/lib/esign/types";

export const QA_ORG = "11111111-1111-4111-8111-111111111111";
export const QA_USER = "22222222-2222-4222-8222-222222222222";
export async function createEsignQaFixture() {
    const database = new PGlite(); await database.exec(await readFile(path.join(process.cwd(), "drizzle/esign/0001.sql"), "utf8"));
    function wrap(db: Pick<PGlite, "query" | "transaction">): EsignSql {
        return { query: (sql, params) => db.query(sql, params), transaction: fn => db.transaction(tx => fn(wrap(tx as unknown as Pick<PGlite, "query" | "transaction">))) };
    }
    const repository = new PostgresEsignRepository(wrap(database));
    const service = new EsignService({ repository, secret: "isolated-esign-qa-only-secret-do-not-use-in-production" });
    const directory = await mkdtemp(path.join(os.tmpdir(), "sendb-esign-qa-"));
    const storage = createEsignStorage(localEsignBlobStore(directory), "isolated-esign-qa-only-secret-do-not-use-in-production");
    const outbox: { id: string; envelopeId: string; recipientId?: string; channel?: string; kind: string; payload: DeliveryPayload }[] = [];
    const actor: EsignActor = { orgId: QA_ORG, userId: QA_USER, workspaceId: 101, name: "가상 검수 담당자" };
    const delivery = {
        async ready() { return true; },
        async send(job: EsignJob, _org: string, payload: DeliveryPayload) {
            // Captures only. This fixture does not import or call a real transport.
            if ((payload.email && !payload.email.endsWith(".example.test")) || (payload.phone && !/^01000000\d{3}$/.test(payload.phone))) throw new Error("Nonfixture recipient forbidden");
            outbox.push({ id: job.id, envelopeId: job.envelopeId, recipientId: job.recipientId, channel: job.channel, kind: job.kind, payload: structuredClone(payload) });
            return { state: "accepted" as const, providerId: "fake-" + randomUUID() };
        },
    };
    const engine = { service, storage, delivery, kick: createEsignJobRunner(service, storage, delivery) };
    const dependencies: EsignHttpDependencies = {
        async engine() { return engine; },
        async authorize(request, workspaceId) { if (request.headers.get("X-Qa-Deny") || ![101, 102].includes(workspaceId)) throw new EsignError("가상 사업의 접근 권한이 없습니다.", 403); return { ...actor, workspaceId }; },
        async status() { return { enabled: true, emailReady: true, smsReady: true, storageReady: true, databaseReady: true, issues: [] }; },
        async prefill(_request, scoped) { return { name: "가상 고객", email: "customer@isolated.example.test", phone: "01000000001", channels: ["email"], recordId: 901, ...(scoped.workspaceId === 102 ? { name: "가상 백오랩 고객" } : {}) }; },
    };
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([595, 842]);
    page.drawText("ISOLATED QA CONTRACT", { x: 48, y: 770, size: 22, font });
    page.drawText("This document and every recipient are fake test data.", { x: 48, y: 720, size: 12, font });
    page.drawText("Name: __________________________", { x: 48, y: 560, size: 14, font });
    page.drawText("Signature: ______________________", { x: 48, y: 450, size: 14, font });
    page.drawText("Date: ___________________________", { x: 48, y: 330, size: 14, font });
    const pdfBytes = await pdf.save();
    return { dependencies, engine, database, actor, outbox, pdfBytes, directory, async flush() { for (let i = 0; i < 5; i++) { await engine.kick(); if (!(await processEsignJobs(service, storage, delivery, 10)).processed) break; } }, async close() { await database.close(); } };
}
