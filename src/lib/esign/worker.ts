import { randomUUID } from "node:crypto";
import type { EsignService } from "./core";
import type { EsignStorage } from "./storage";
import type { EsignDelivery } from "./delivery";
import { completePdfInWorker } from "./pdf-worker";
import type { PdfImagePlacement } from "./pdf-types";
import { EsignError, type DeliveryPayload } from "./types";

/** One bounded batch; no file/network work is performed inside a DB transaction. */
export async function processEsignJobs(service: EsignService, storage: EsignStorage, delivery: EsignDelivery, limit = 4) {
    await service.expireDue(5);
    let processed = 0;
    for (; processed < Math.min(10, Math.max(1, limit)); processed++) {
        const job = await service.claimJob(120_000);
        if (!job) break;
        const lease = job.leaseId!;
        if (job.kind === "finalize") {
            try {
                const input = await service.getFinalizationInput(job.id, job.envelopeId, lease);
                const original = await storage.get(input.document.artifact), placements: PdfImagePlacement[] = [];
                for (const recipient of input.recipients) for (const value of recipient.values) {
                    const field = input.document.fields.find(f => f.id === value.fieldId && f.recipientIndex === recipient.index);
                    if (!field || !value.artifact) throw new EsignError("서명 입력의 저장 기록을 확인해주세요.", 409);
                    placements.push({ pageIndex: field.pageIndex, x: field.x, y: field.y, width: field.width, height: field.height, png: await storage.get(value.artifact) });
                }
                const bytes = await completePdfInWorker(original, placements);
                const artifact = await storage.put(`esign/completed/${job.envelopeId}/${randomUUID()}.pdf`, bytes, "application/pdf");
                const stored = await storage.get(artifact);
                // Completion is verified by the original composition worker and by stored bytes/hash.
                // Source inspection has a smaller 10 MB limit and is not reused for a 25 MB completed PDF.
                if (!stored.length || artifact.sha256 === input.document.artifact.sha256) throw new EsignError("완료 문서를 확인할 수 없습니다.", 500);
                await service.finishEnvelope(job.id, job.envelopeId, lease, { artifact, verified: true });
            } catch {
                await service.failFinalization(job.id, job.envelopeId, lease).catch(() => undefined);
            }
        } else {
            const aggregate = await service.repository.read(job.envelopeId);
            if (!aggregate) continue;
            const current = aggregate.jobs.find(item => item.id === job.id);
            // Cancellation may have committed after the claim. Recheck before any external side effect.
            if (!current || current.state !== "processing" || current.leaseId !== lease || !current.leaseUntil || new Date(current.leaseUntil).getTime() <= Date.now()) continue;
            const allowed = current.kind === "completed" ? aggregate.envelope.state === "completed"
                : current.kind === "invitation" ? aggregate.envelope.state === "pending"
                : ["pending", "finalizing", "completed"].includes(aggregate.envelope.state);
            const expired = aggregate.envelope.state === "pending" && new Date(aggregate.envelope.expiresAt).getTime() <= Date.now();
            if (!allowed || expired) {
                await service.completeDelivery(job.id, job.envelopeId, lease, { state: "failed", error: "서명 요청의 현재 상태에서 발송할 수 없습니다." }).catch(() => undefined);
                continue;
            }
            let payload: DeliveryPayload;
            try { payload = service.decodeJob(current); }
            catch {
                await service.completeDelivery(job.id, job.envelopeId, lease, { state: "failed", error: "발송 내용을 확인하지 못해 보내지 않았습니다." }).catch(() => undefined);
                continue;
            }
            try {
                const recipient = aggregate.recipients.find(item => item.id === current.recipientId);
                if (current.kind === "otp" && (!recipient?.otpExpiresAt || new Date(recipient.otpExpiresAt).getTime() <= Date.now() || recipient.otpChallenge !== payload.otpChallenge)) {
                    await service.completeDelivery(job.id, job.envelopeId, lease, { state: "failed", error: "이 확인 코드는 만료되었거나 새 코드로 바뀌었습니다." });
                    continue;
                }
                await service.completeDelivery(job.id, job.envelopeId, lease, await delivery.send(current, aggregate.envelope.orgId, payload));
            }
            catch { await service.completeDelivery(job.id, job.envelopeId, lease, { state: "unknown", error: "접수 여부를 확인할 수 없습니다. 중복 발송 전에 확인해주세요." }).catch(() => undefined); }
        }
    }
    return { processed };
}

export function createEsignJobRunner(service: EsignService, storage: EsignStorage, delivery: EsignDelivery) {
    let running: Promise<void> | undefined;
    return () => running ??= processEsignJobs(service, storage, delivery).then(() => undefined).finally(() => { running = undefined; });
}
