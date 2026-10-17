import type { EsignRepository, EsignAggregate } from "./repository";
import { EsignError, type EsignActor, type EsignDocument, type EsignJob } from "./types";
const copy = <T>(value: T): T => structuredClone(value);
export class MemoryEsignRepository implements EsignRepository {
    private readonly docs = new Map<string, EsignDocument>();
    private readonly aggregates = new Map<string, EsignAggregate>();
    async saveDocument(document: EsignDocument, expectedVersion?: number) {
        const current = this.docs.get(document.id);
        if (expectedVersion === undefined ? !!current : !current || current.version !== expectedVersion)
            throw new EsignError("문서가 변경되었습니다. 다시 열어주세요.", 409, "conflict");
        this.docs.set(document.id, copy(document));
    }
    async document(actor: EsignActor, id: string) {
        const row = this.docs.get(id);
        return row && row.orgId === actor.orgId && row.workspaceId === actor.workspaceId ? copy(row) : null;
    }
    async documents(actor: EsignActor) {
        return [...this.docs.values()].filter((d) => d.orgId === actor.orgId && d.workspaceId === actor.workspaceId).slice(-100).reverse().map(copy);
    }
    async create(aggregate: EsignAggregate) {
        if (this.aggregates.has(aggregate.envelope.id)) throw new EsignError("이미 생성된 서명 요청입니다.", 409);
        this.aggregates.set(aggregate.envelope.id, copy(aggregate));
    }
    async list(actor: EsignActor) {
        return [...this.aggregates.values()].filter((a) => a.envelope.orgId === actor.orgId && a.envelope.workspaceId === actor.workspaceId).slice(-100).reverse().map((a) => ({ envelope: copy(a.envelope), recipients: copy(a.recipients), events: [], jobs: [] }));
    }
    async read(id: string) { const row = this.aggregates.get(id); return row ? copy(row) : null; }
    async recipientByTokenHash(hash: string) {
        for (const a of this.aggregates.values()) {
            const r = a.recipients.find((r) => r.tokenHash === hash);
            if (r) return { envelopeId: a.envelope.id, recipientId: r.id };
        }
        return null;
    }
    async dueExpirations(now: string, limit: number) {
        return [...this.aggregates.values()].filter((a) => ["draft", "pending"].includes(a.envelope.state) && a.envelope.expiresAt <= now).sort((a, b) => a.envelope.expiresAt.localeCompare(b.envelope.expiresAt)).slice(0, limit).map((a) => a.envelope.id);
    }
    async mutate<T>(id: string, action: (aggregate: EsignAggregate) => T): Promise<T> {
        const row = this.aggregates.get(id);
        if (!row) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404, "not_found");
        const next = copy(row);
        next.envelope.version = row.envelope.version + 1;
        const result = action(next);
        if (result instanceof Promise) throw new Error("Esign mutation callback must be synchronous");
        this.aggregates.set(id, next);
        return copy(result);
    }
    async claimJob(now: string, leaseUntil: string, leaseId: string): Promise<EsignJob | null> {
        for (const aggregate of this.aggregates.values()) {
            for (const job of aggregate.jobs) {
                if (job.state === "processing" && job.leaseUntil && job.leaseUntil <= now && job.kind !== "finalize") {
                    job.state = "unknown"; job.error = "전송 중 연결이 종료되어 접수 여부를 확인해야 합니다.";
                    job.updatedAt = now;
                    if (job.kind !== "invitation") delete job.encryptedPayload;
                    delete job.leaseId; delete job.leaseUntil;
                }
            }
        }
        const all = [...this.aggregates.values()].flatMap((a) => a.jobs);
        const finalizeBusy = all.some((j) => j.kind === "finalize" && j.state === "processing" && !!j.leaseUntil && j.leaseUntil > now);
        const candidates = all.filter((j) =>
            !((j.kind === "finalize") && finalizeBusy) && ((j.state === "pending" && j.availableAt <= now) || (j.kind === "finalize" && j.state === "processing" && !!j.leaseUntil && j.leaseUntil <= now)),
        ).sort((a, b) => {
            const priority = (j: EsignJob) => j.kind === "otp" ? 0 : j.kind === "finalize" ? 1 : 2;
            return priority(a) - priority(b) || a.availableAt.localeCompare(b.availableAt) || a.id.localeCompare(b.id);
        });
        const job = candidates[0];
        if (!job) return null;
        job.state = "processing"; job.leaseId = leaseId; job.leaseUntil = leaseUntil;
        job.attempts++; job.updatedAt = now;
        return copy(job);
    }
}
