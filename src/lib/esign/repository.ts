import type { EsignDocument, EsignEnvelope, EsignRecipient, EsignEvent, EsignJob, EsignActor } from "./types";
export type EsignAggregate = { envelope: EsignEnvelope; recipients: EsignRecipient[]; events: EsignEvent[]; jobs: EsignJob[] };
/** Callback is synchronous: network, file operations and rendering must run outside this transaction. */
export interface EsignRepository {
    saveDocument(document: EsignDocument, expectedVersion?: number): Promise<void>;
    document(actor: EsignActor, id: string): Promise<EsignDocument | null>;
    documents(actor: EsignActor): Promise<EsignDocument[]>;
    create(aggregate: EsignAggregate): Promise<void>;
    /** At most 100 scoped summaries; events/jobs are empty. Use read() for the full audit/deliveries. */
    list(actor: EsignActor): Promise<EsignAggregate[]>;
    read(id: string): Promise<EsignAggregate | null>;
    recipientByTokenHash(hash: string): Promise<{ envelopeId: string; recipientId: string } | null>;
    dueExpirations(now: string, limit: number): Promise<string[]>;
    mutate<T>(id: string, action: (aggregate: EsignAggregate) => T): Promise<T>;
    claimJob(now: string, leaseUntil: string, leaseId: string): Promise<EsignJob | null>;
    close?(): Promise<void>;
}
