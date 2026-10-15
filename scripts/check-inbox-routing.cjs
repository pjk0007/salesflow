/* eslint-disable @typescript-eslint/no-require-imports -- 가상 팀·직원·격리 SQL/API 검사 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function main() {
    await runPlatformCheck(async (ctx) => {
        const { db, pg, actor, repo, channels, clients, dispatch, contacts } =
            ctx;
        const s = require("../src/lib/db/schema.ts"),
            { eq, and, sql } = require("drizzle-orm");
        const routing = require("../src/lib/inbox-routing/repository.ts"),
            { generateToken } = require("../src/lib/auth.ts");
        const people = {
            a: {
                id: randomUUID(),
                name: "가상 라온",
                workspace: 8,
                role: "agent",
            },
            b: {
                id: randomUUID(),
                name: "가상 다온",
                workspace: 8,
                role: "agent",
            },
            c: {
                id: randomUUID(),
                name: "가상 백오랩 팀원",
                workspace: 10,
                role: "agent",
            },
            viewer: {
                id: randomUUID(),
                name: "가상 열람 직원",
                workspace: 8,
                role: "viewer",
            },
            extra: {
                id: randomUUID(),
                name: "가상 다른 팀원",
                workspace: 8,
                role: "agent",
            },
        };
        for (const p of Object.values(people)) {
            await db.insert(s.users).values({
                id: p.id,
                orgId: actor.orgId,
                name: p.name,
                email: p.id + "@example.test",
                password: "fake-only",
            });
            await db.insert(s.organizationMembers).values({
                organizationId: actor.orgId,
                userId: p.id,
                role: "member",
            });
            await db.insert(s.customerWorkspaceAccess).values({
                orgId: actor.orgId,
                userId: p.id,
                workspaceId: p.workspace,
                role: p.role,
            });
        }
        const staff = (p) => ({
            ...actor,
            userId: p.id,
            name: p.name,
            role: "member",
        });
        async function native(who, path, body, method = "POST", status = 200) {
            const r = await dispatch("http://127.0.0.1:3120" + path, {
                method: body ? method : "GET",
                headers: {
                    Authorization:
                        "Bearer " +
                        generateToken({ ...who, email: "qa@example.test" }),
                    "Content-Type": "application/json",
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            assert.equal(r.status, status, await r.clone().text());
            return (await r.json()).data;
        }
        async function check(name, fn) {
            await fn();
            console.log("PASS ROUTING " + ++count + " " + name);
        }
        const session = async (
            name = "가상 팀 문의",
            channel = channels.dh,
        ) => {
            const v = await repo.startVisitorSession(
                channel.publicKey,
                { name },
                db,
            );
            await repo.sendVisitorMessage(
                channel.publicKey,
                v.token,
                { clientId: randomUUID(), body: name },
                db,
            );
            return v;
        };
        const chat = async (id) =>
            (await repo.conversationDetail(actor, id, db)).conversation;
        const patch = async (id, change) =>
            repo.patchConversation(
                actor,
                id,
                { version: (await chat(id)).version, ...change },
                db,
            );
        let count = 0,
            manual,
            automatic,
            bo;
        await check(
            "마이그레이션·팀 생성/목록과 사업별 같은 이름 격리",
            async () => {
                manual = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "Sales",
                    memberIds: [people.a.id],
                });
                bo = await clients.bo.createInboxTeam({
                    channelId: channels.bo.id,
                    name: "Sales",
                    memberIds: [people.c.id],
                });
                assert.notEqual(manual.id, bo.id);
                assert.equal(
                    (await clients.dh.inboxTeams(channels.dh.id)).length,
                    1,
                );
                assert.equal(manual.autoAssign, false);
                assert.equal(manual.members[0].eligible, true);
            },
        );
        await check(
            "팀 관리·서비스 키 범위는 기존 사업 권한을 넘지 못함",
            async () => {
                await assert.rejects(clients.bo.inboxTeams(channels.dh.id));
                await assert.rejects(
                    clients.read.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "blocked",
                    }),
                );
                await native(
                    staff(people.viewer),
                    "/api/inbox-routing/teams?channelId=" + channels.dh.id,
                    null,
                    "GET",
                );
                await native(
                    staff(people.viewer),
                    "/api/inbox-routing/teams",
                    { channelId: channels.dh.id, name: "blocked" },
                    "POST",
                    403,
                );
                await native(
                    staff(people.c),
                    "/api/inbox-routing/teams?channelId=" + channels.dh.id,
                    null,
                    "GET",
                    403,
                );
            },
        );
        await check(
            "팀 구성은 응대 가능한 직원만 신규 추가하고 중복/위조 필드 거절",
            async () => {
                await assert.rejects(
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "viewer",
                        memberIds: [people.viewer.id],
                    }),
                );
                await assert.rejects(
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "other workspace",
                        memberIds: [people.c.id],
                    }),
                );
                await assert.rejects(
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "dup",
                        memberIds: [people.a.id, people.a.id],
                    }),
                );
                await native(
                    actor,
                    "/api/inbox-routing/teams",
                    {
                        channelId: channels.dh.id,
                        name: "forged",
                        orgId: randomUUID(),
                    },
                    "POST",
                    400,
                );
            },
        );
        await check(
            "이름 중복·오래된 설정 버전 차단, 같은 설정 재저장은 멱등",
            async () => {
                await assert.rejects(
                    clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: " sales ",
                    }),
                );
                const same = await clients.dh.updateInboxTeam(manual.id, {
                    version: manual.version,
                    name: "Sales",
                });
                assert.equal(same.version, manual.version);
                manual = await clients.dh.updateInboxTeam(manual.id, {
                    version: manual.version,
                    description: "도입 문의",
                });
                await assert.rejects(
                    clients.dh.updateInboxTeam(manual.id, {
                        version: 1,
                        description: "old",
                    }),
                );
                assert.equal(manual.description, "도입 문의");
            },
        );
        const first = await session();
        await check(
            "수동 팀 이관은 기존 개인 담당을 해제하고 팀원만 재배정",
            async () => {
                await patch(first.id, { assigneeId: people.b.id });
                const v = await patch(first.id, { teamId: manual.id });
                assert.equal(v.assigneeId, null);
                assert.equal(v.teamId, manual.id);
                await assert.rejects(
                    patch(first.id, { assigneeId: people.b.id }),
                );
                await patch(first.id, { assigneeId: people.a.id });
                assert.equal((await chat(first.id)).assigneeId, people.a.id);
            },
        );
        await check(
            "팀 이관 감사·팀원/관리자 앱 알림과 다른 팀원 제외",
            async () => {
                const notes = await db
                    .select()
                    .from(s.inboxNotifications)
                    .where(
                        and(
                            eq(s.inboxNotifications.conversationId, first.id),
                            eq(s.inboxNotifications.type, "assigned"),
                        ),
                    );
                const teamNotes = notes.filter((n) =>
                    n.preview.includes("담당팀"),
                );
                assert.deepEqual(
                    new Set(teamNotes.map((n) => n.userId)),
                    new Set([actor.userId, people.a.id]),
                );
                const audit =
                    await require("../src/lib/inbox/audit.ts").inboxAuditPage(
                        actor.orgId,
                        channels.dh.id,
                        first.id,
                        undefined,
                        db,
                    );
                assert.ok(
                    audit.rows.some(
                        (r) => r.changes.teamId?.after === manual.id,
                    ),
                );
            },
        );
        await check(
            "팀/팀 없음/내 팀 필터와 집계가 같은 서버 조건 사용",
            async () => {
                const mine = await repo.conversationListPage(
                    staff(people.a),
                    channels.dh.id,
                    { filter: "myTeams" },
                    undefined,
                    undefined,
                    db,
                );
                assert.ok(mine.rows.some((r) => r.id === first.id));
                assert.ok(mine.counts.myTeams >= 1);
                const outsider = await repo.listConversations(
                    staff(people.b),
                    channels.dh.id,
                    db,
                    undefined,
                    undefined,
                    { filter: "myTeams" },
                );
                assert.equal(outsider.length, 0);
                const selected = await repo.conversationListPage(
                    actor,
                    channels.dh.id,
                    { teamId: manual.id },
                    undefined,
                    undefined,
                    db,
                );
                assert.equal(selected.rows.length, 1);
                assert.equal(selected.counts.all, 1);
                const none = await repo.listConversations(
                    actor,
                    channels.dh.id,
                    db,
                    undefined,
                    undefined,
                    { teamId: "none" },
                );
                assert.ok(none.every((r) => !r.teamId));
                assert.equal(
                    (
                        await clients.dh.conversations(channels.dh.id, {
                            teamId: bo.id,
                        })
                    ).length,
                    0,
                );
            },
        );
        await check("다른 사업 팀은 API와 DB 복합 관계 모두 차단", async () => {
            await assert.rejects(patch(first.id, { teamId: bo.id }));
            await assert.rejects(
                db
                    .update(s.inboxConversations)
                    .set({ teamId: bo.id })
                    .where(eq(s.inboxConversations.id, first.id)),
            );
        });
        await check(
            "사람이 켠 팀만 진행중 상담 수와 마지막 자동 배정 순으로 배정",
            async () => {
                automatic = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "자동 상담팀",
                    autoAssign: true,
                    memberIds: [people.a.id, people.b.id],
                });
                const one = await session("가상 자동1"),
                    two = await session("가상 자동2");
                assert.equal(
                    (await patch(one.id, { teamId: automatic.id })).assigneeId,
                    people.b.id,
                );
                assert.equal(
                    (await patch(two.id, { teamId: automatic.id })).assigneeId,
                    people.a.id,
                );
            },
        );
        await check(
            "여러 요청을 같은 팀에 배정해도 활성 상담 부하 차이는 1 이하",
            async () => {
                const rooms = await Promise.all(
                    Array.from({ length: 6 }, (_, i) =>
                        session("가상 동시 " + i),
                    ),
                );
                await Promise.all(
                    rooms.map((r) => patch(r.id, { teamId: automatic.id })),
                );
                const active = await db
                    .select({ assigneeId: s.inboxConversations.assigneeId })
                    .from(s.inboxConversations)
                    .where(
                        and(
                            eq(s.inboxConversations.channelId, channels.dh.id),
                            eq(s.inboxConversations.status, "open"),
                        ),
                    );
                const a = active.filter(
                        (r) => r.assigneeId === people.a.id,
                    ).length,
                    b = active.filter(
                        (r) => r.assigneeId === people.b.id,
                    ).length;
                assert.ok(Math.abs(a - b) <= 1);
            },
        );
        await check(
            "현재 응대 권한 회수는 자동/수동 후보에서 즉시 제외",
            async () => {
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "viewer" })
                    .where(eq(s.customerWorkspaceAccess.userId, people.b.id));
                const room = await session("가상 권한 회수");
                assert.equal(
                    (await patch(room.id, { teamId: automatic.id })).assigneeId,
                    people.a.id,
                );
                await assert.rejects(
                    patch(room.id, { assigneeId: people.b.id }),
                );
                const edited = await clients.dh.updateInboxTeam(automatic.id, {
                    version: automatic.version,
                    description: "회수된 팀원 유지",
                    memberIds: automatic.memberIds,
                });
                automatic = edited;
                assert.equal(
                    edited.members.find((m) => m.id === people.b.id).eligible,
                    false,
                );
            },
        );
        await check(
            "응대 가능한 팀원이 없으면 미배정 팀 대기열에 보존",
            async () => {
                await db
                    .update(s.customerWorkspaceAccess)
                    .set({ role: "viewer" })
                    .where(eq(s.customerWorkspaceAccess.userId, people.a.id));
                const room = await session("가상 빈 대기열");
                const v = await patch(room.id, { teamId: automatic.id });
                assert.equal(v.teamId, automatic.id);
                assert.equal(v.assigneeId, null);
            },
        );
        await check(
            "팀 보관은 기존 상담을 보존하며 새 팀 배정만 차단",
            async () => {
                automatic = await clients.dh.updateInboxTeam(automatic.id, {
                    version: automatic.version,
                    enabled: false,
                });
                const existing = await clients.dh.conversations(
                    channels.dh.id,
                    { teamId: automatic.id },
                );
                assert.ok(existing.length >= 1);
                assert.ok(existing.every((c) => c.teamId === automatic.id));
                const room = await session("가상 보관팀");
                await assert.rejects(patch(room.id, { teamId: automatic.id }));
                await patch(existing[0].id, { assigneeId: null });
                await patch(existing[0].id, { teamId: null });
                assert.equal((await chat(existing[0].id)).teamId, null);
            },
        );
        await check(
            "회원 연결은 기존 회원의 담당팀/담당자 조합을 우선 보존",
            async () => {
                const identity = await clients.dh.customerIdentity(
                    channels.dh.id,
                    contacts.dh.id,
                );
                const member = (
                    await clients.dh.conversations(channels.dh.id)
                ).find((c) => c.contactId === contacts.dh.id);
                await patch(member.id, { teamId: manual.id, assigneeId: null });
                const source = await session("가상 연결 전 팀"),
                    otherTeam = await clients.dh.createInboxTeam({
                        channelId: channels.dh.id,
                        name: "다른 담당팀",
                        memberIds: [actor.userId],
                    });
                await patch(source.id, {
                    teamId: otherTeam.id,
                    assigneeId: actor.userId,
                });
                const r = await dispatch(
                    "http://127.0.0.1:3120/api/messenger/" +
                        channels.dh.publicKey,
                    {
                        method: "POST",
                        headers: {
                            Authorization: "Bearer " + identity.identityToken,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            action: "identify",
                            anonymousToken: source.token,
                        }),
                    },
                );
                assert.equal(r.status, 200);
                const merged = await chat(member.id);
                assert.equal(merged.teamId, manual.id);
                assert.equal(merged.assigneeId, null);
            },
        );
        let aiTeam;
        await check(
            "AI 사람 이관도 팀 밖의 지정 직원을 배정하지 않고 팀 설정 사용",
            async () => {
                const {
                    handoffSupport,
                } = require("../src/lib/customer-ai/queue.ts");
                aiTeam = await clients.dh.createInboxTeam({
                    channelId: channels.dh.id,
                    name: "AI 이관팀",
                    autoAssign: true,
                    memberIds: [actor.userId],
                });
                const room = await session("가상 AI 팀 이관");
                await patch(room.id, { teamId: aiTeam.id });
                await patch(room.id, { assigneeId: null });
                await db.transaction((tx) =>
                    handoffSupport(tx, room.id, "가상 AI 검수", {
                        handoffAssigneeId: people.extra.id,
                    }),
                );
                assert.equal((await chat(room.id)).assigneeId, actor.userId);
                const manualRoom = await session("가상 AI 수동팀");
                await patch(manualRoom.id, { teamId: manual.id });
                await db.transaction((tx) =>
                    handoffSupport(tx, manualRoom.id, "가상 수동 대기", {
                        handoffAssigneeId: people.extra.id,
                    }),
                );
                assert.equal((await chat(manualRoom.id)).assigneeId, null);
            },
        );
        await check(
            "기존 회원 담당이 없는 백오랩 연결은 비회원 담당팀/담당자 계승",
            async () => {
                const room = await session(
                    "가상 백오랩 회원 연결",
                    channels.bo,
                );
                await patch(room.id, {
                    teamId: bo.id,
                    assigneeId: people.c.id,
                });
                const identity = await clients.bo.customerIdentity(
                    channels.bo.id,
                    contacts.bo.id,
                );
                const r = await dispatch(
                    "http://127.0.0.1:3120/api/messenger/" +
                        channels.bo.publicKey,
                    {
                        method: "POST",
                        headers: {
                            Authorization: "Bearer " + identity.identityToken,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            action: "identify",
                            anonymousToken: room.token,
                        }),
                    },
                );
                assert.equal(r.status, 200);
                const linked = (
                    await clients.bo.conversations(channels.bo.id)
                ).find((c) => c.contactId === contacts.bo.id);
                assert.equal(linked.teamId, bo.id);
                assert.equal(linked.assigneeId, people.c.id);
                const visible = await dispatch(
                    "http://127.0.0.1:3120/api/messenger/" +
                        channels.bo.publicKey,
                    {
                        headers: {
                            Authorization: "Bearer " + identity.identityToken,
                        },
                    },
                );
                assert.equal("teamId" in (await visible.json()).data, false);
            },
        );
        await check(
            "감사 실패는 자동 배정과 배정 순서 기록까지 롤백",
            async () => {
                const room = await session("가상 배정 롤백"),
                    before = await db
                        .select()
                        .from(s.inboxTeamMembers)
                        .where(eq(s.inboxTeamMembers.teamId, aiTeam.id));
                await db.execute(
                    sql`CREATE FUNCTION qa_reject_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='conversation.updated' THEN RAISE EXCEPTION 'fake rollback'; END IF; RETURN NEW; END $$`,
                );
                await db.execute(
                    sql`CREATE TRIGGER qa_reject_assignment BEFORE INSERT ON inbox_audit_events FOR EACH ROW EXECUTE FUNCTION qa_reject_assignment()`,
                );
                await assert.rejects(patch(room.id, { teamId: aiTeam.id }));
                const after = await db
                    .select()
                    .from(s.inboxTeamMembers)
                    .where(eq(s.inboxTeamMembers.teamId, aiTeam.id));
                assert.deepEqual(after, before);
                assert.equal((await chat(room.id)).teamId, null);
                await db.execute(
                    sql`DROP TRIGGER qa_reject_assignment ON inbox_audit_events`,
                );
                await db.execute(sql`DROP FUNCTION qa_reject_assignment()`);
            },
        );
        await check("감사 저장 실패는 팀/구성원 변경을 전체 롤백", async () => {
            await db.execute(
                sql`CREATE FUNCTION qa_reject_team_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='team.updated' THEN RAISE EXCEPTION 'fake rollback'; END IF; RETURN NEW; END $$`,
            );
            await db.execute(
                sql`CREATE TRIGGER qa_reject_team_audit BEFORE INSERT ON inbox_audit_events FOR EACH ROW EXECUTE FUNCTION qa_reject_team_audit()`,
            );
            await assert.rejects(
                routing.saveTeam(
                    actor,
                    manual.id,
                    {
                        version: manual.version,
                        name: "롤백 이름",
                        memberIds: [],
                    },
                    db,
                ),
            );
            const current = await routing.readTeam(actor, manual.id, db);
            assert.equal(current.name, "Sales");
            assert.deepEqual(current.memberIds, manual.memberIds);
            await db.execute(
                sql`DROP TRIGGER qa_reject_team_audit ON inbox_audit_events`,
            );
            await db.execute(sql`DROP FUNCTION qa_reject_team_audit()`);
        });
        console.log(
            "상담팀 SQL/API QA " + count + "개 통과 · 실제 DB/외부 발송 없음",
        );
        await pg.close();
    });
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
