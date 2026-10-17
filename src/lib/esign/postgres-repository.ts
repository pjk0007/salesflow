import postgres from "postgres";
import type { EsignAggregate, EsignRepository } from "./repository";
import { EsignError, type EsignActor, type EsignDocument, type EsignEvent, type EsignJob, type EsignRecipient, type EsignEnvelope } from "./types";

/** Adapter boundary also accepts an isolated PostgreSQL-compatible test database. */
export interface EsignSql {
    query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
    transaction<T>(action: (tx: EsignSql) => Promise<T>): Promise<T>;
    close?(): Promise<void>;
}
export function createPostgresEsignSql(databaseUrl: string, maxConnections = 2): EsignSql {
    if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new EsignError("전자서명 전용 DB 설정이 필요합니다.", 503, "configuration");
    const client = postgres(databaseUrl, { max: Math.max(1, Math.min(3, Math.trunc(maxConnections) || 2)), connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
    const wrap = (connection: { unsafe: (text: string, params?: never[]) => Promise<unknown> }, transaction?: EsignSql["transaction"]): EsignSql => ({
        async query<T>(text: string, params: unknown[] = []) { return { rows: await connection.unsafe(text, params as never[]) as T[] }; },
        transaction: transaction ?? (async () => { throw new Error("Nested esign transaction is not supported"); }),
    });
    const sql = wrap(client, async (action) => client.begin(async (tx) => action(wrap(tx))) as Promise<never>);
    sql.close = async () => { await client.end({ timeout: 5 }); };
    return sql;
}
type DataRow<T> = { data: T };
async function aggregate(sql: EsignSql, id: string, lock = false): Promise<EsignAggregate | null> {
    const result = await sql.query<DataRow<EsignEnvelope>>(`SELECT data FROM esign.envelopes WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!result.rows[0]) return null;
    const recipients = await sql.query<DataRow<EsignRecipient>>("SELECT data FROM esign.recipients WHERE envelope_id=$1 ORDER BY (data->>'index')::integer", [id]);
    const events = await sql.query<DataRow<EsignEvent>>("SELECT data FROM esign.events WHERE envelope_id=$1 ORDER BY created_at,id", [id]);
    const jobs = await sql.query<DataRow<EsignJob>>("SELECT data FROM esign.jobs WHERE envelope_id=$1 ORDER BY CASE WHEN kind='otp' THEN 0 WHEN kind='finalize' THEN 1 ELSE 2 END,available_at,id", [id]);
    return { envelope: result.rows[0].data, recipients: recipients.rows.map((r) => r.data), events: events.rows.map((r) => r.data), jobs: jobs.rows.map((r) => r.data) };
}
async function saveChildren(sql: EsignSql, value: EsignAggregate) {
    // JSONB parameters stay structured: postgres.js encodes them; pre-stringifying double-encodes JSON.
    for (const r of value.recipients) await sql.query(
        "INSERT INTO esign.recipients(id,envelope_id,token_hash,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        [r.id, r.envelopeId, r.tokenHash, r],
    );
    for (const e of value.events) await sql.query(
        "INSERT INTO esign.events(id,envelope_id,data,created_at) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(id) DO NOTHING",
        [e.id, e.envelopeId, e, e.at],
    );
    for (const j of value.jobs) await sql.query(
        "INSERT INTO esign.jobs(id,envelope_id,kind,state,job_key,available_at,lease_until,data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(id) DO UPDATE SET state=excluded.state,available_at=excluded.available_at,lease_until=excluded.lease_until,data=excluded.data",
        [j.id, j.envelopeId, j.kind, j.state, j.key, j.availableAt, j.leaseUntil ?? null, j, j.createdAt],
    );
}
async function saveAggregate(sql: EsignSql, value: EsignAggregate, expectedVersion: number) {
    value.envelope.version = expectedVersion + 1;
    const e = value.envelope, result = await sql.query<{ id: string }>(
        "UPDATE esign.envelopes SET version=$2,state=$3,expires_at=$4,data=$5::jsonb WHERE id=$1 AND version=$6 RETURNING id",
        [e.id, e.version, e.state, e.expiresAt, e, expectedVersion],
    );
    if (!result.rows.length) throw new EsignError("서명 요청이 변경되었습니다. 다시 시도해주세요.", 409, "conflict");
    await saveChildren(sql, value);
}
export class PostgresEsignRepository implements EsignRepository {
    constructor(private readonly sql: EsignSql) {}
    async saveDocument(document: EsignDocument, expectedVersion?: number) {
        const d = document;
        if (expectedVersion === undefined) {
            const result = await this.sql.query<{ id: string }>("INSERT INTO esign.documents(id,org_id,workspace_id,version,data,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(id) DO NOTHING RETURNING id", [d.id, d.orgId, d.workspaceId, d.version, d, d.createdAt]);
            if (result.rows.length) return;
        } else {
            const result = await this.sql.query<{ id: string }>("UPDATE esign.documents SET version=$2,data=$3::jsonb WHERE id=$1 AND version=$4 AND org_id=$5 AND workspace_id=$6 RETURNING id", [d.id, d.version, d, expectedVersion, d.orgId, d.workspaceId]);
            if (result.rows.length) return;
        }
        throw new EsignError("문서가 변경되었습니다. 다시 열어주세요.", 409, "conflict");
    }
    async document(actor: EsignActor, id: string) {
        const result = await this.sql.query<DataRow<EsignDocument>>("SELECT data FROM esign.documents WHERE id=$1 AND org_id=$2 AND workspace_id=$3", [id, actor.orgId, actor.workspaceId]);
        return result.rows[0]?.data ?? null;
    }
    async documents(actor: EsignActor) {
        const result = await this.sql.query<DataRow<EsignDocument>>("SELECT data FROM esign.documents WHERE org_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id LIMIT 100", [actor.orgId, actor.workspaceId]);
        return result.rows.map((r) => r.data);
    }
    async create(value: EsignAggregate) {
        await this.sql.transaction(async (tx) => {
            const e = value.envelope;
            await tx.query("INSERT INTO esign.envelopes(id,org_id,workspace_id,version,state,expires_at,data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [e.id, e.orgId, e.workspaceId, e.version, e.state, e.expiresAt, e, e.createdAt]);
            await saveChildren(tx, value);
        });
    }
    async list(actor: EsignActor) {
        // List pages need only envelope/recipient summaries, never encrypted jobs or full audits.
        const result = await this.sql.query<DataRow<EsignEnvelope>>("SELECT data FROM esign.envelopes WHERE org_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100", [actor.orgId, actor.workspaceId]);
        if (!result.rows.length) return [];
        const ids = result.rows.map((r) => r.data.id);
        const recipients = await this.sql.query<DataRow<EsignRecipient>>("SELECT data FROM esign.recipients WHERE envelope_id=ANY($1::uuid[]) ORDER BY (data->>'index')::integer", [ids]);
        return result.rows.map((row) => ({ envelope: row.data, recipients: recipients.rows.map((r) => r.data).filter((r) => r.envelopeId === row.data.id), events: [], jobs: [] }));
    }
    read(id: string) {
        return this.sql.transaction(async (tx) => {
            await tx.query("SELECT id FROM esign.envelopes WHERE id=$1 FOR SHARE", [id]);
            return aggregate(tx, id);
        });
    }
    async recipientByTokenHash(hash: string) {
        const result = await this.sql.query<{ envelope_id: string; id: string }>("SELECT envelope_id,id FROM esign.recipients WHERE token_hash=$1", [hash]);
        return result.rows[0] ? { envelopeId: result.rows[0].envelope_id, recipientId: result.rows[0].id } : null;
    }
    async dueExpirations(now: string, limit: number) {
        const result = await this.sql.query<{ id: string }>("SELECT id FROM esign.envelopes WHERE state IN ('draft','pending') AND expires_at<=$1 ORDER BY expires_at,id LIMIT $2", [now, limit]);
        return result.rows.map((r) => r.id);
    }
    mutate<T>(id: string, action: (value: EsignAggregate) => T): Promise<T> {
        return this.sql.transaction(async (tx) => {
            const value = await aggregate(tx, id, true);
            if (!value) throw new EsignError("서명 요청을 찾을 수 없습니다.", 404, "not_found");
            const version = value.envelope.version;
            value.envelope.version = version + 1;
            const result = action(value);
            if (result instanceof Promise) throw new Error("Esign mutation callback must be synchronous");
            await saveAggregate(tx, value, version);
            return structuredClone(result);
        });
    }
    claimJob(now: string, leaseUntil: string, leaseId: string): Promise<EsignJob | null> {
        return this.sql.transaction(async (tx) => {
            // Serialize only the short claim decision, never transport or PDF work.
            const lock = await tx.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(1936029031) AS acquired");
            if (!lock.rows[0]?.acquired) return null;
            const busy = await tx.query<{ busy: boolean }>("SELECT EXISTS(SELECT 1 FROM esign.jobs WHERE kind='finalize' AND state='processing' AND lease_until>$1) AS busy", [now]);
            const finalizeBusy = busy.rows[0]?.busy ?? false;
            // Envelope lock is always acquired before child locks, matching every state mutation.
            const candidate = await tx.query<{ id: string }>(`SELECT e.id FROM esign.jobs j JOIN esign.envelopes e ON e.id=j.envelope_id WHERE
                ((j.state='pending' AND j.available_at<=$1) OR (j.state='processing' AND j.lease_until<=$1))
                AND (NOT $2::boolean OR j.kind<>'finalize')
                ORDER BY CASE WHEN j.kind='otp' THEN 0 WHEN j.kind='finalize' THEN 1 ELSE 2 END,j.available_at,j.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED`, [now, finalizeBusy]);
            if (!candidate.rows[0]) return null;
            const value = (await aggregate(tx, candidate.rows[0].id))!, version = value.envelope.version;
            for (const job of value.jobs) if (job.state === "processing" && job.leaseUntil && job.leaseUntil <= now && job.kind !== "finalize") {
                job.state = "unknown"; job.error = "전송 중 연결이 종료되어 접수 여부를 확인해야 합니다."; job.updatedAt = now;
                if (job.kind !== "invitation") delete job.encryptedPayload;
                delete job.leaseId; delete job.leaseUntil;
            }
            const job = value.jobs.find((j) => !(j.kind === "finalize" && finalizeBusy) && ((j.state === "pending" && j.availableAt <= now) || (j.kind === "finalize" && j.state === "processing" && !!j.leaseUntil && j.leaseUntil <= now)));
            if (job) { job.state = "processing"; job.leaseId = leaseId; job.leaseUntil = leaseUntil; job.attempts++; job.updatedAt = now; }
            await saveAggregate(tx, value, version);
            return job ?? null;
        });
    }
    async close() { await this.sql.close?.(); }
}
export function createPostgresEsignRepository(databaseUrl: string, maxConnections = 2) {
    return new PostgresEsignRepository(createPostgresEsignSql(databaseUrl, maxConnections));
}
