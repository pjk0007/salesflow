import { S3Client } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { EsignService } from "./core";
import { createPostgresEsignSql, PostgresEsignRepository } from "./postgres-repository";
import { createEsignStorage, localEsignBlobStore, s3EsignBlobStore } from "./storage";
import { createEsignDelivery } from "./delivery";
import { selectEsignAlimtalkSenderKey, selectEsignEmailSender } from "./sender";
import { mergeContactPrefill, recordRecipientFields } from "./prefill";
import { createEsignAlimtalk, type EsignAlimtalkStatus } from "./alimtalk";
import { createEsignJobRunner } from "./worker";
import { EsignError, type EsignActor, type EsignRecipientInput } from "./types";
import type { EsignEngine, EsignHttpDependencies } from "./http";

function config() {
    const enabled = process.env.ESIGN_ENABLED === "on", secret = process.env.ESIGN_SECRET ?? "", databaseUrl = process.env.ESIGN_DATABASE_URL ?? "";
    const local = process.env.NODE_ENV !== "production" ? process.env.ESIGN_STORAGE_DIR : undefined;
    const storageReady = Boolean(local || (process.env.ESIGN_S3_ENDPOINT && process.env.ESIGN_S3_BUCKET && process.env.ESIGN_S3_ACCESS_KEY_ID && process.env.ESIGN_S3_SECRET_ACCESS_KEY));
    const issues: string[] = [];
    const configuredWriteMode = process.env.ESIGN_S3_WRITE_MODE || "conditional";
    const writeMode: "conditional" | "content-addressed" = configuredWriteMode === "content-addressed" ? "content-addressed" : "conditional";
    if (configuredWriteMode !== "conditional" && configuredWriteMode !== "content-addressed") issues.push("계약 파일 저장 방식을 확인해주세요.");
    if (!enabled) issues.push("전자서명 기능을 아직 활성화하지 않았습니다.");
    if (secret.length < 32) issues.push("전자서명 전용 암호화 키가 필요합니다.");
    if (!databaseUrl) issues.push("전자서명 메타데이터 DB 연결이 필요합니다.");
    if (!storageReady) issues.push("계약 전용 파일 저장소가 필요합니다.");
    if (enabled && process.env.ESIGN_WORKER !== "on") issues.push("전자서명 작업 실행을 활성화해야 합니다.");
    return { enabled, secret, databaseUrl, local, storageReady, issues, writeMode };
}
async function userFrom(request: Request) {
    const user = await getActiveUserFromNextRequest(request as NextRequest);
    if (!user) throw new EsignError("로그인이 필요합니다.", 401, "unauthenticated");
    return user;
}
type Runtime = EsignEngine & { databaseReady(): Promise<boolean> };
const shared = globalThis as typeof globalThis & { __sendbEsignRuntime?: Runtime; __sendbEsignTimer?: ReturnType<typeof setTimeout> };
function runtime(): Runtime {
    if (shared.__sendbEsignRuntime) return shared.__sendbEsignRuntime;
    const cfg = config();
    if (!cfg.enabled || cfg.issues.length) throw new EsignError(cfg.issues.join(" "), 503, "configuration");
    const sql = createPostgresEsignSql(cfg.databaseUrl, 2), repository = new PostgresEsignRepository(sql);
    let raw;
    if (cfg.local) raw = localEsignBlobStore(cfg.local);
    else {
        const endpoint = new URL(process.env.ESIGN_S3_ENDPOINT!);
        if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
            throw new EsignError("계약 파일 저장소 주소를 확인해주세요.", 503);
        raw = s3EsignBlobStore(new S3Client({ endpoint: endpoint.toString(), region: process.env.ESIGN_S3_REGION || "auto", credentials: { accessKeyId: process.env.ESIGN_S3_ACCESS_KEY_ID!, secretAccessKey: process.env.ESIGN_S3_SECRET_ACCESS_KEY! } }), process.env.ESIGN_S3_BUCKET!, cfg.writeMode);
    }
    const storage = createEsignStorage(raw, cfg.secret), service = new EsignService({ repository, secret: cfg.secret });
    const delivery = createEsignDelivery({
        publicOrigin: process.env.ESIGN_PUBLIC_ORIGIN || "https://sendb.kr",
        alimtalk: createEsignAlimtalk({
            enabled: process.env.ESIGN_ALIMTALK === "on",
            publicOrigin: process.env.ESIGN_PUBLIC_ORIGIN || "https://sendb.kr",
            async config(orgId) {
                const [{ db, alimtalkConfigs }, { and, eq }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
                const [config] = await db.select().from(alimtalkConfigs).where(and(eq(alimtalkConfigs.orgId, orgId), eq(alimtalkConfigs.isActive, 1))).limit(1);
                const senderKey = selectEsignAlimtalkSenderKey({ fixedKey: process.env.ESIGN_ALIMTALK_SENDER_KEY, fixedOrgId: process.env.ESIGN_ALIMTALK_SENDER_ORG_ID, orgId, defaultSenderKey: config?.defaultSenderKey });
                return config && senderKey ? { appKey: config.appKey, secretKey: config.secretKey, senderKey } : null;
            },
        }),
        sms: { appKey: process.env.ESIGN_SMS_APP_KEY || "", secretKey: process.env.ESIGN_SMS_SECRET_KEY || "", sender: process.env.ESIGN_SMS_SENDER || "" },
        async emailSender(orgId) {
            const [{ getEmailConfig, NhnEmailClient }, { loadOrgSenderProfiles }] = await Promise.all([import("@/lib/nhn-email"), import("@/lib/email-sender-resolver")]);
            const email = await getEmailConfig(orgId);
            if (!email) return null;
            const sender = selectEsignEmailSender(process.env.ESIGN_EMAIL_SENDER, await loadOrgSenderProfiles(orgId), email);
            if (!sender.fromEmail) return null;
            const client = new NhnEmailClient(email.appKey, email.secretKey, { orgId });
            return { address: sender.fromEmail, name: sender.fromName, submit: request => client.sendEachMail(request) };
        },
    });
    if (process.env.ESIGN_ALIMTALK_SENDER_KEY && !process.env.ESIGN_ALIMTALK_SENDER_ORG_ID)
        console.warn("[esign] ESIGN_ALIMTALK_SENDER_KEY는 ESIGN_ALIMTALK_SENDER_ORG_ID(소유 조직)와 함께 지정해야 그 조직에 적용됩니다. 지금은 키가 기본 채널과 같은 조직에만 적용합니다.");
    const kick = createEsignJobRunner(service, storage, delivery);
    const value: Runtime = { service, storage, delivery, kick, async databaseReady() { const result = await sql.query<{ ready: boolean }>("SELECT to_regclass('esign.envelopes') IS NOT NULL AS ready"); return Boolean(result.rows[0]?.ready); } };
    shared.__sendbEsignRuntime = value;
    // Only an explicitly enabled module starts a bounded, indexed queue scan.
    if (process.env.ESIGN_WORKER === "on" && !shared.__sendbEsignTimer) {
        const tick = () => { shared.__sendbEsignTimer = setTimeout(() => { void kick().catch(() => undefined).finally(tick); }, 15_000); shared.__sendbEsignTimer.unref(); };
        tick();
    }
    return value;
}

/** Restart recovery must not depend on a staff member opening the e-sign screen. */
export function startEsignScheduler() {
    if (process.env.ESIGN_ENABLED !== "on" || process.env.ESIGN_WORKER !== "on") return;
    try { runtime(); }
    catch { console.error("[esign] 전자서명 실행 설정을 확인해주세요. 작업을 시작하지 않았습니다."); }
}
export const esignHttpDependencies: EsignHttpDependencies = {
    async engine() { return runtime(); },
    async authorize(request, workspaceId, capability) {
        const user = await userFrom(request);
        try {
            const { requireCustomerAccess } = await import("@/lib/customer-access/access");
            const actor = await requireCustomerAccess(user, workspaceId, capability);
            return { orgId: actor.orgId, userId: actor.userId, name: actor.name, workspaceId };
        } catch (error) {
            const e = error as { status?: number; message?: string };
            throw new EsignError(e.message || "이 사업의 접근 권한이 필요합니다.", e.status ?? 403);
        }
    },
    async status(request) {
        const user = await userFrom(request), cfg = config();
        let databaseReady = false, emailReady = false, smsReady = false;
        let alimtalk: EsignAlimtalkStatus = { ready: false, templates: [], reason: "전자서명 연결을 먼저 준비해주세요." };
        const issues = [...cfg.issues];
        if (cfg.enabled && !cfg.issues.length) {
            try {
                const app = runtime();
                [databaseReady, emailReady, smsReady, alimtalk] = await Promise.all([app.databaseReady(), app.delivery.ready("email", user.orgId), app.delivery.ready("sms", user.orgId), app.delivery.alimtalkStatus!(user.orgId)]);
                if (!databaseReady) issues.push("전자서명 메타데이터 테이블 준비가 필요합니다.");
            } catch { issues.push("전자서명 연결 상태를 확인해주세요."); }
            if (process.env.ESIGN_WORKER !== "on") issues.push("지속적인 발송 처리를 위해 전자서명 작업 실행을 설정해주세요.");
        }
        return { enabled: cfg.enabled, emailReady, smsReady, alimtalkReady: alimtalk.ready, alimtalk, databaseReady, storageReady: cfg.storageReady && cfg.secret.length >= 32, issues };
    },
    async organizationName(orgId) {
        const [{ db, organizations }, { eq }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
        const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
        return org?.name || undefined;
    },
    async unsubscribedEmails(orgId, emails) {
        const { isOrganizationUnsubscribed } = await import("@/lib/email-unsubscribe");
        const checked = await Promise.all(emails.map(async email => ({ email, blocked: await isOrganizationUnsubscribed(orgId, email) })));
        return checked.filter(item => item.blocked).map(item => item.email);
    },
    async prefill(request, actor: EsignActor, params) {
        const user = await userFrom(request);
        const { db, crmContacts, fieldDefinitions, workspaces } = await import("@/lib/db");
        const { and, eq, isNull } = await import("drizzle-orm");
        const contactId = params.get("contactId"), recordId = Number(params.get("recordId"));
        if (contactId && !/^[a-f0-9-]{36}$/.test(contactId)) throw new EsignError("고객 ID를 확인해주세요.");
        if (!contactId && (!Number.isSafeInteger(recordId) || recordId < 1)) throw new EsignError("고객 또는 레코드를 선택해주세요.");
        let recordData: Record<string, unknown> | undefined;
        let fieldTypeId: number | null | undefined;
        if (recordId) {
            const { requireRecordAccess } = await import("@/lib/partition-access");
            const access = await requireRecordAccess(user, recordId, "read");
            if (!access.ok) throw new EsignError(access.error, access.status);
            if (access.partition.workspaceId !== actor.workspaceId) throw new EsignError("이 사업의 레코드가 아닙니다.", 404);
            recordData = access.record.data as Record<string, unknown>; fieldTypeId = access.partition.fieldTypeId;
        }
        // 레코드 값(권한 확인 완료)은 고객 카드의 빈 칸을 채우는 데도 쓴다.
        let recordFields: Partial<ReturnType<typeof recordRecipientFields>> = {};
        if (recordData) {
            if (!fieldTypeId) { const [workspace] = await db.select({ fieldTypeId: workspaces.defaultFieldTypeId }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).limit(1); fieldTypeId = workspace?.fieldTypeId; }
            const definitions = await db.select({ key: fieldDefinitions.key, label: fieldDefinitions.label, type: fieldDefinitions.fieldType }).from(fieldDefinitions).where(fieldTypeId ? eq(fieldDefinitions.fieldTypeId, fieldTypeId) : eq(fieldDefinitions.workspaceId, actor.workspaceId));
            recordFields = recordRecipientFields(definitions, recordData);
        }
        const [contact] = await db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, phone: crmContacts.phone }).from(crmContacts).where(and(eq(crmContacts.orgId, actor.orgId), eq(crmContacts.workspaceId, actor.workspaceId), isNull(crmContacts.archivedAt), contactId ? eq(crmContacts.id, contactId) : eq(crmContacts.recordId, recordId))).limit(1);
        if (contact) return { contactId: contact.id, ...(recordId ? { recordId } : {}), ...mergeContactPrefill(contact, recordFields), channels: [] };
        if (!recordData) throw new EsignError("고객을 찾을 수 없습니다.", 404);
        return { recordId, ...mergeContactPrefill({}, recordFields), channels: [] } as EsignRecipientInput;
    },
};
