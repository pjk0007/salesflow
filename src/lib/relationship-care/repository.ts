import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
    db,
    crmCompanies,
    crmContactCompanies,
    crmContacts,
    crmRelationshipCare,
    customerWorkspaceAccess,
    emailSendLogs,
    organizationMembers,
    users,
} from "@/lib/db";
import { permitsCustomerRole } from "@/lib/customer-access/rules";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import {
    requireCustomerAccess,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { appendActivity } from "@/lib/customer-platform/activities";
import { platformContact, upsertContact } from "@/lib/customer-platform/repository";
import {
    ACTION_LABEL,
    DAILY_CARD_LIMIT,
    MARKETING_DEFER_DAYS,
    REASON_LABEL,
    SOON_DAYS,
    STATUS_LABEL,
    TIER_LABEL,
    addDays,
    applyAction,
    baseDraft,
    businessCardInput,
    cadenceOf,
    careActionInput,
    careSettingsInput,
    compareCards,
    daysSince,
    decideCard,
    phoneDigits,
    seasonOf,
    statusOf,
    welcomeDeadline,
    type CardReason,
    type CareState,
} from "./rules";
type CareRow = typeof crmRelationshipCare.$inferSelect;
const stateOf = (row: CareRow): CareState => ({
    tier: row.tier as CareState["tier"],
    cadenceDays: row.cadenceDays,
    lastTouchAt: row.lastTouchAt,
    nextDueAt: row.nextDueAt,
    snoozedUntil: row.snoozedUntil,
    memoryNote: row.memoryNote,
    importantDates: row.importantDates,
    unansweredCount: row.unansweredCount,
});
/** 날짜만 받은 입력(YYYY-MM-DD)은 서울 정오로 저장해 날짜가 밀리지 않게 한다 */
const seoulNoon = (day: string) => new Date(`${day}T12:00:00+09:00`);
const seoulDay = (at: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(at);
/** 보관된 고객은 관계 관리를 바꾸지 않는다(화면과 같은 기준을 API에도 적용) */
async function activeContact(
    orgId: string,
    workspaceId: number,
    contactId: string,
    exec: DbExec,
) {
    const contact = await platformContact(orgId, workspaceId, contactId, exec);
    if (contact.archivedAt)
        throw new InboxError("보관된 고객입니다. 복구한 뒤 관계 관리를 바꿔주세요.");
    return contact;
}
const ALREADY_MANAGED = "이미 관계 관리 중인 고객입니다. 고객 상세에서 설정을 바꿔주세요.";
function describe(row: CareRow, now: Date) {
    const state = stateOf(row);
    return {
        ...row,
        tierLabel: TIER_LABEL[state.tier],
        cadence: cadenceOf(state),
        status: statusOf(state, now),
        statusLabel: STATUS_LABEL[statusOf(state, now)],
        welcomeDeadline: row.lastTouchAt ? null : welcomeDeadline(row.createdAt),
        daysSinceTouch: daysSince(row.lastTouchAt, now),
    };
}
/** 담당자는 지금 조직에 소속돼 있고 이 사업의 고객 업무를 볼 수 있는 직원이어야 한다 */
async function eligibleOwner(
    orgId: string,
    workspaceId: number,
    userId: string | null | undefined,
    exec: DbExec,
) {
    if (!userId) return;
    // dev 분기에는 공용 findActiveMembership 가 없어 customer-access/access.ts 의 activeMembership 과 같은 조회를 둔다.
    const [member] = await exec
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, orgId),
                eq(organizationMembers.userId, userId),
                eq(users.isActive, 1),
            ),
        );
    let allowed = !!member;
    if (member?.role === "member") {
        const [grant] = await exec
            .select({ role: customerWorkspaceAccess.role })
            .from(customerWorkspaceAccess)
            .where(
                and(
                    eq(customerWorkspaceAccess.orgId, orgId),
                    eq(customerWorkspaceAccess.workspaceId, workspaceId),
                    eq(customerWorkspaceAccess.userId, userId),
                ),
            );
        allowed = permitsCustomerRole(grant?.role ?? "none", "read");
    }
    if (!allowed)
        throw new InboxError("이 사업의 고객 업무를 볼 수 있는 직원만 담당자로 지정할 수 있습니다.");
}
export async function getCare(
    actor: CustomerActor,
    workspaceId: number,
    contactId: string,
    now = new Date(),
) {
    await requireCustomerAccess(actor, workspaceId, "read");
    await platformContact(actor.orgId, workspaceId, contactId);
    const [row] = await db
        .select()
        .from(crmRelationshipCare)
        .where(
            and(
                eq(crmRelationshipCare.contactId, contactId),
                eq(crmRelationshipCare.orgId, actor.orgId),
                eq(crmRelationshipCare.workspaceId, workspaceId),
            ),
        );
    return { care: row ? describe(row, now) : null };
}
/** 관계 관리 시작·설정 변경. 등급·주기·마지막 연락일이 바뀌면 다음 점검일을 다시 계산한다. */
export async function saveCare(
    actor: CustomerActor,
    contactId: string,
    raw: unknown,
    now = new Date(),
) {
    const input = careSettingsInput.parse(raw);
    const access = await requireCustomerAccess(actor, input.workspaceId, "respond");
    return db.transaction(async (tx) => {
        await activeContact(actor.orgId, input.workspaceId, contactId, tx);
        await eligibleOwner(actor.orgId, input.workspaceId, input.ownerUserId, tx);
        const [before] = await tx
            .select()
            .from(crmRelationshipCare)
            .where(
                and(
                    eq(crmRelationshipCare.contactId, contactId),
                    eq(crmRelationshipCare.orgId, actor.orgId),
                    eq(crmRelationshipCare.workspaceId, input.workspaceId),
                ),
            )
            .for("update");
        if (before && input.version !== undefined && input.version !== before.version)
            throw new InboxError(
                "다른 사람이 관계 관리 설정을 바꿨습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        // 화면은 마지막 연락 시각을 날짜로만 다룬다. 같은 서울 날짜면 기존 시각을 그대로 둬서
        // 메모만 고쳐 저장해도 건너뛰기·미루기가 풀리지 않게 한다.
        const lastTouchAt =
            input.lastTouchOn === undefined
                ? (before?.lastTouchAt ?? null)
                : !input.lastTouchOn
                  ? null
                  : before?.lastTouchAt && seoulDay(before.lastTouchAt) === input.lastTouchOn
                    ? before.lastTouchAt
                    : seoulNoon(input.lastTouchOn);
        if (lastTouchAt && lastTouchAt.getTime() > now.getTime() + 86_400_000)
            throw new InboxError("마지막 연락일은 오늘 이후로 정할 수 없습니다.");
        const cadenceDays =
            input.cadenceDays === undefined ? (before?.cadenceDays ?? null) : input.cadenceDays;
        const scheduleChanged =
            !before ||
            before.tier !== input.tier ||
            before.cadenceDays !== cadenceDays ||
            before.lastTouchAt?.getTime() !== lastTouchAt?.getTime();
        // 첫 인사 전이면 바로 카드에 오르도록 다음 점검일을 지금으로 둔다.
        const nextDueAt = !scheduleChanged
            ? before!.nextDueAt
            : lastTouchAt
              ? addDays(lastTouchAt, cadenceOf({ tier: input.tier, cadenceDays }))
              : (before?.nextDueAt ?? now);
        const values = {
            tier: input.tier,
            cadenceDays,
            ownerUserId:
                input.ownerUserId === undefined
                    ? (before?.ownerUserId ?? actor.userId)
                    : input.ownerUserId,
            metPlace: input.metPlace === undefined ? (before?.metPlace ?? null) : input.metPlace || null,
            metOn: input.metOn === undefined ? (before?.metOn ?? null) : input.metOn,
            memoryNote: input.memoryNote ?? before?.memoryNote ?? "",
            importantDates: input.importantDates ?? before?.importantDates ?? [],
            lastTouchAt,
            nextDueAt,
            snoozedUntil: scheduleChanged ? null : (before?.snoozedUntil ?? null),
            updatedAt: now,
        };
        const [row] = before
            ? await tx
                  .update(crmRelationshipCare)
                  .set({ ...values, version: before.version + 1 })
                  .where(eq(crmRelationshipCare.contactId, contactId))
                  .returning()
            : await tx
                  .insert(crmRelationshipCare)
                  .values({
                      ...values,
                      contactId,
                      orgId: actor.orgId,
                      workspaceId: input.workspaceId,
                  })
                  .onConflictDoNothing()
                  .returning();
        if (!row)
            throw new InboxError(
                "다른 사람이 방금 관계 관리를 시작했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        await appendActivity(tx, {
            orgId: actor.orgId,
            workspaceId: input.workspaceId,
            contactId,
            source: "relationship",
            entityId: contactId,
            eventKey: `relationship:${randomUUID()}`,
            action: before ? "relationship.updated" : "relationship.started",
            summary: before
                ? `관계 관리 설정 변경 · ${TIER_LABEL[input.tier]}`
                : `관계 관리 시작 · ${TIER_LABEL[input.tier]}`,
            actorName: access.name,
            metadata: { tier: input.tier, cadenceDays },
            occurredAt: now,
        });
        return { care: describe(row, now) };
    });
}
export async function applyCareAction(
    actor: CustomerActor,
    contactId: string,
    raw: unknown,
    now = new Date(),
) {
    const input = careActionInput.parse(raw);
    const access = await requireCustomerAccess(actor, input.workspaceId, "respond");
    return db.transaction(async (tx) => {
        await activeContact(actor.orgId, input.workspaceId, contactId, tx);
        const [before] = await tx
            .select()
            .from(crmRelationshipCare)
            .where(
                and(
                    eq(crmRelationshipCare.contactId, contactId),
                    eq(crmRelationshipCare.orgId, actor.orgId),
                    eq(crmRelationshipCare.workspaceId, input.workspaceId),
                ),
            )
            .for("update");
        if (!before) throw new InboxError("관계 관리를 먼저 시작해주세요.", 404);
        const next = applyAction(stateOf(before), input.action, now, input.channel);
        const [row] = await tx
            .update(crmRelationshipCare)
            .set({ ...next, version: before.version + 1, updatedAt: now })
            .where(eq(crmRelationshipCare.contactId, contactId))
            .returning();
        const channel = input.channel ? CHANNEL_LABEL[input.channel] : null;
        await appendActivity(tx, {
            orgId: actor.orgId,
            workspaceId: input.workspaceId,
            contactId,
            source: "relationship",
            entityId: contactId,
            eventKey: `relationship:${randomUUID()}`,
            action: `relationship.${input.action}`,
            summary: [
                ACTION_LABEL[input.action],
                channel,
                next.tier !== before.tier
                    ? `무응답 누적으로 ${TIER_LABEL[next.tier as CareState["tier"]]} 조정`
                    : null,
            ]
                .filter(Boolean)
                .join(" · "),
            actorName: access.name,
            metadata: {
                channel: input.channel ?? null,
                reason: input.reason ?? null,
                note: input.note ?? null,
                tierBefore: before.tier,
                tierAfter: next.tier,
            },
            occurredAt: now,
        });
        return { care: describe(row, now) };
    });
}
export const CHANNEL_LABEL = {
    email: "메일",
    sms: "문자",
    kakao: "카카오톡",
    call: "통화",
    meeting: "만남",
    other: "기타",
} as const;
/** 최근 마케팅 메일 수신 시각(받는 사람 메일 기준). 관계 인사는 샌드비 발송 기록에 남지 않으므로 모두 마케팅으로 본다. */
async function lastMarketingByEmail(orgId: string, emails: string[], now: Date) {
    if (!emails.length) return new Map<string, Date>();
    const rows = await db
        .select({
            email: sql<string>`lower(${emailSendLogs.recipientEmail})`,
            at: sql<Date>`max(${emailSendLogs.sentAt})`,
        })
        .from(emailSendLogs)
        .where(
            and(
                eq(emailSendLogs.orgId, orgId),
                inArray(sql`lower(${emailSendLogs.recipientEmail})`, emails),
                gt(emailSendLogs.sentAt, addDays(now, -MARKETING_DEFER_DAYS)),
                sql`${emailSendLogs.status} <> 'failed'`,
            ),
        )
        .groupBy(sql`lower(${emailSendLogs.recipientEmail})`);
    return new Map(rows.map((r) => [r.email, new Date(r.at)]));
}
/**
 * 오늘의 인사 카드. 한 번에 최대 10장(내 인맥 보기는 합쳐서 10장, 사업 전체는 담당자별 10장).
 * 밀린 카드는 앞 카드를 처리하면 올라온다. scope=mine 이면 내가 담당이거나 담당자가 없는 인맥만 본다.
 * 초안 서명은 카드를 보는 사람(실제로 보내는 사람) 이름으로 한다.
 */
export async function todayCards(
    actor: CustomerActor,
    workspaceId: number,
    scope: "mine" | "all",
    now = new Date(),
) {
    const access = await requireCustomerAccess(actor, workspaceId, "read");
    const scoped = and(
        eq(crmRelationshipCare.orgId, actor.orgId),
        eq(crmRelationshipCare.workspaceId, workspaceId),
        isNull(crmContacts.archivedAt),
        scope === "mine"
            ? or(
                  eq(crmRelationshipCare.ownerUserId, actor.userId),
                  isNull(crmRelationshipCare.ownerUserId),
              )
            : undefined,
    );
    const rows = await db
        .select({
            care: crmRelationshipCare,
            contact: {
                id: crmContacts.id,
                name: crmContacts.name,
                email: crmContacts.email,
                phone: crmContacts.phone,
                attributes: crmContacts.attributes,
            },
            ownerName: users.name,
        })
        .from(crmRelationshipCare)
        .innerJoin(crmContacts, eq(crmContacts.id, crmRelationshipCare.contactId))
        .leftJoin(users, eq(users.id, crmRelationshipCare.ownerUserId))
        .where(
            and(
                scoped,
                or(
                    lte(crmRelationshipCare.nextDueAt, addDays(now, SOON_DAYS)),
                    sql`jsonb_array_length(${crmRelationshipCare.importantDates}) > 0`,
                ),
            ),
        )
        .limit(2000);
    const marketing = await lastMarketingByEmail(
        actor.orgId,
        [...new Set(rows.map((r) => r.contact.email?.toLowerCase()).filter((e): e is string => !!e))],
        now,
    );
    const season = seasonOf(now);
    let deferred = 0;
    const candidates = rows
        .map((r) => {
            const state = stateOf(r.care);
            const decision = decideCard(
                state,
                now,
                r.contact.email ? (marketing.get(r.contact.email.toLowerCase()) ?? null) : null,
            );
            if (decision.deferredByMarketing) deferred++;
            return { r, state, decision };
        })
        .filter((c) => c.decision.show)
        .map(({ r, state, decision }) => ({
            contactId: r.contact.id,
            name: r.contact.name,
            email: r.contact.email,
            phone: r.contact.phone,
            companyName: textAttr(r.contact.attributes, "companyName"),
            title: textAttr(r.contact.attributes, "title"),
            tier: state.tier,
            tierLabel: TIER_LABEL[state.tier],
            version: r.care.version,
            ownerUserId: r.care.ownerUserId,
            ownerName: r.ownerName,
            status: decision.status,
            statusLabel: STATUS_LABEL[decision.status],
            reason: decision.reason,
            reasonLabel:
                decision.reason === "anniversary" && decision.anniversary
                    ? `${decision.anniversary.label} ${decision.anniversary.inDays ? `${decision.anniversary.inDays}일 뒤` : "오늘"}`
                    : decision.reason === "welcome" &&
                        welcomeDeadline(r.care.createdAt).getTime() < now.getTime()
                      ? "첫 인사 · 48시간 기한이 지났지만 지금이라도"
                      : REASON_LABEL[decision.reason],
            memoryNote: state.memoryNote,
            metPlace: r.care.metPlace,
            lastTouchAt: state.lastTouchAt,
            daysSinceTouch: daysSince(state.lastTouchAt, now),
            nextDueAt: state.nextDueAt,
            welcomeDeadline: state.lastTouchAt ? null : welcomeDeadline(r.care.createdAt),
            draft: baseDraft({
                contactName: r.contact.name,
                senderName: access.name,
                reason: decision.reason,
                metPlace: r.care.metPlace,
                anniversaryLabel: decision.anniversary?.label,
                season,
            }),
        }))
        .sort(compareCards(now));
    const perOwner = new Map<string, number>();
    const cards = candidates.filter((c) => {
        // 내 인맥 보기는 담당자 없는 카드까지 합쳐 한 사람이 처리할 10장이다.
        const key = scope === "mine" ? "me" : (c.ownerUserId ?? "none");
        const used = perOwner.get(key) ?? 0;
        if (used >= DAILY_CARD_LIMIT) return false;
        perOwner.set(key, used + 1);
        return true;
    });
    const [summary] = await db
        .select({
            managed: sql<number>`count(*)::int`,
            overdue: sql<number>`count(*) filter (where ${crmRelationshipCare.lastTouchAt} is not null and ${crmRelationshipCare.nextDueAt} < ${now.toISOString()}::timestamptz)::int`,
            welcome: sql<number>`count(*) filter (where ${crmRelationshipCare.lastTouchAt} is null)::int`,
        })
        .from(crmRelationshipCare)
        .innerJoin(crmContacts, eq(crmContacts.id, crmRelationshipCare.contactId))
        .where(scoped);
    return {
        cards,
        counts: {
            managed: summary?.managed ?? 0,
            overdue: summary?.overdue ?? 0,
            welcome: summary?.welcome ?? 0,
            candidates: candidates.length,
            carriedOver: candidates.length - cards.length,
            deferredByMarketing: deferred,
        },
    };
}
const textAttr = (attributes: Record<string, unknown>, key: string) =>
    typeof attributes[key] === "string" ? (attributes[key] as string) : null;
/** 같은 사업에서 메일 또는 전화번호가 같은 보관되지 않은 고객 */
async function duplicateContacts(
    orgId: string,
    workspaceId: number,
    email: string | null | undefined,
    phone: string | null | undefined,
) {
    const digits = phoneDigits(phone);
    if (!email && digits.length < 8) return [];
    return db
        .select({
            id: crmContacts.id,
            name: crmContacts.name,
            email: crmContacts.email,
            phone: crmContacts.phone,
        })
        .from(crmContacts)
        .where(
            and(
                eq(crmContacts.orgId, orgId),
                eq(crmContacts.workspaceId, workspaceId),
                isNull(crmContacts.archivedAt),
                or(
                    email ? sql`lower(${crmContacts.email}) = ${email.toLowerCase()}` : undefined,
                    digits.length >= 8
                        ? sql`regexp_replace(coalesce(${crmContacts.phone}, ''), '[^0-9]', '', 'g') = ${digits}`
                        : undefined,
                ),
            ),
        )
        .limit(5);
}
/**
 * 명함 등록: 고객을 만들고(또는 기존 고객에 붙이고) 관계 관리를 시작한다.
 * 메일·전화가 같은 기존 고객이 있으면 저장하지 않고 후보를 돌려준다(합치기 제안).
 * 명함 사진은 저장하지 않는다.
 */
export async function registerBusinessCard(
    actor: CustomerActor,
    raw: unknown,
    now = new Date(),
) {
    const input = businessCardInput.parse(raw);
    const access = await requireCustomerAccess(actor, input.workspaceId, "respond");
    if (!input.attachToContactId && !input.allowDuplicate) {
        const duplicates = await duplicateContacts(
            actor.orgId,
            input.workspaceId,
            input.email,
            input.phone,
        );
        if (duplicates.length) return { status: "duplicate" as const, duplicates };
    }
    return db.transaction(async (tx) => {
        let contactId = input.attachToContactId;
        if (contactId) {
            const existing = await activeContact(actor.orgId, input.workspaceId, contactId, tx);
            const [managed] = await tx
                .select({ id: crmRelationshipCare.contactId })
                .from(crmRelationshipCare)
                .where(eq(crmRelationshipCare.contactId, contactId));
            if (managed) throw new InboxError(ALREADY_MANAGED, 409);
            // 합치기: 기존 고객의 비어 있는 칸만 명함 정보로 채운다(있는 값은 덮어쓰지 않는다).
            const missing = Object.fromEntries(
                Object.entries({
                    companyName: input.companyName,
                    title: input.title,
                    website: input.website,
                }).filter(([key, v]) => v && !textAttr(existing.attributes, key)),
            );
            const fill = {
                ...(!existing.email && input.email ? { email: input.email } : {}),
                ...(!existing.phone && input.phone ? { phone: input.phone } : {}),
            };
            if (Object.keys(missing).length || Object.keys(fill).length)
                await upsertContact(
                    actor.orgId,
                    {
                        workspaceId: input.workspaceId,
                        externalId: existing.externalId,
                        name: existing.name,
                        ...fill,
                        attributes: missing,
                    },
                    true,
                    tx,
                    { actor: { userId: actor.userId, name: access.name }, source: "staff" },
                );
        } else {
            const [company] = input.companyName
                ? await tx
                      .select({ id: crmCompanies.id })
                      .from(crmCompanies)
                      .where(
                          and(
                              eq(crmCompanies.orgId, actor.orgId),
                              eq(crmCompanies.workspaceId, input.workspaceId),
                              isNull(crmCompanies.archivedAt),
                              sql`lower(${crmCompanies.name}) = lower(${input.companyName})`,
                          ),
                      )
                      .limit(1)
                : [];
            const attributes = Object.fromEntries(
                Object.entries({
                    source: "business_card",
                    companyName: input.companyName,
                    title: input.title,
                    website: input.website,
                }).filter(([, v]) => v),
            );
            const saved = await upsertContact(
                actor.orgId,
                {
                    workspaceId: input.workspaceId,
                    externalId: `card:${randomUUID()}`,
                    name: input.name,
                    email: input.email ?? null,
                    phone: input.phone ?? null,
                    lifecycleStage: "lead",
                    attributes,
                    ...(company ? { companyIds: [company.id] } : {}),
                },
                false,
                tx,
                { actor: { userId: actor.userId, name: access.name }, source: "staff" },
            );
            contactId = saved.id;
        }
        const [row] = await tx
            .insert(crmRelationshipCare)
            .values({
                contactId,
                orgId: actor.orgId,
                workspaceId: input.workspaceId,
                tier: input.tier,
                ownerUserId: actor.userId,
                metPlace: input.metPlace || null,
                metOn: input.metOn ?? null,
                memoryNote: input.memoryNote ?? "",
                nextDueAt: now,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoNothing()
            .returning();
        if (!row) throw new InboxError(ALREADY_MANAGED, 409);
        await appendActivity(tx, {
            orgId: actor.orgId,
            workspaceId: input.workspaceId,
            contactId,
            source: "relationship",
            entityId: contactId,
            eventKey: `relationship:${randomUUID()}`,
            action: "relationship.business_card",
            summary: `명함 등록 · ${TIER_LABEL[input.tier]}${input.metPlace ? ` · ${input.metPlace}` : ""}`,
            actorName: access.name,
            metadata: { tier: input.tier, metPlace: input.metPlace ?? null },
            occurredAt: now,
        });
        return { status: "created" as const, contactId, care: describe(row, now) };
    });
}
/** AI 초안에 넘길 문맥: 이름·회사·직함·만난 곳·기억 메모·최근 연락 기록 5건 */
export async function draftContext(
    actor: CustomerActor,
    workspaceId: number,
    contactId: string,
    reason: CardReason,
    now = new Date(),
) {
    const access = await requireCustomerAccess(actor, workspaceId, "respond");
    const contact = await activeContact(actor.orgId, workspaceId, contactId, db);
    const [care] = await db
        .select()
        .from(crmRelationshipCare)
        .where(
            and(
                eq(crmRelationshipCare.contactId, contactId),
                eq(crmRelationshipCare.orgId, actor.orgId),
                eq(crmRelationshipCare.workspaceId, workspaceId),
            ),
        );
    if (!care) throw new InboxError("관계 관리를 먼저 시작해주세요.", 404);
    const companies = await db
        .select({ name: crmCompanies.name })
        .from(crmContactCompanies)
        .innerJoin(crmCompanies, eq(crmCompanies.id, crmContactCompanies.companyId))
        .where(eq(crmContactCompanies.contactId, contactId));
    const decision = decideCard(stateOf(care), now);
    return {
        senderName: access.name,
        contactName: contact.name,
        companyName: companies[0]?.name ?? textAttr(contact.attributes, "companyName"),
        title: textAttr(contact.attributes, "title"),
        metPlace: care.metPlace,
        metOn: care.metOn,
        memoryNote: care.memoryNote,
        reason,
        reasonLabel: REASON_LABEL[reason],
        anniversaryLabel: decision.anniversary?.label ?? null,
        daysSinceTouch: daysSince(care.lastTouchAt, now),
        season: seasonOf(now),
    };
}
