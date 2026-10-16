/* eslint-disable @typescript-eslint/no-require-imports -- 가상 신청 정보·격리 SQL/API 검사 */
const assert = require("node:assert/strict");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
const { randomUUID } = require("node:crypto");
async function main() {
    await runPlatformCheck(
        async ({
            db,
            pg,
            channels,
            contacts,
            clients,
            repo,
            dispatch,
            actor,
        }) => {
            const s = require("../src/lib/db/schema.ts"),
                { eq } = require("drizzle-orm");
            const { inboxAuditPage } = require("../src/lib/inbox/audit.ts");
            let count = 0;
            async function api(
                key,
                token,
                body,
                status = 200,
                origin = "http://127.0.0.1:3122",
            ) {
                const r = await dispatch(
                    "http://127.0.0.1:3120/api/messenger/" + key,
                    {
                        method: body ? "POST" : "GET",
                        headers: {
                            Origin: origin,
                            ...(body
                                ? { "Content-Type": "application/json" }
                                : {}),
                            ...(token
                                ? { Authorization: "Bearer " + token }
                                : {}),
                        },
                        ...(body ? { body: JSON.stringify(body) } : {}),
                    },
                );
                assert.equal(r.status, status, await r.clone().text());
                return r.json();
            }
            async function check(name, fn) {
                await fn();
                console.log("PASS VISITOR PROFILE " + ++count + " " + name);
            }
            try {
                const key = channels.dh.publicKey;
                const a = await repo.startVisitorSession(
                    key,
                    { name: "가상 이전 이름", email: "old@example.test" },
                    db,
                );
                await repo.sendVisitorMessage(
                    key,
                    a.token,
                    { clientId: randomUUID(), body: "가상 기존 문의" },
                    db,
                );
                await check(
                    "같은 익명 상담의 이름/이메일만 변경하며 이력·고객 연결을 보존",
                    async () => {
                        const value = await api(key, a.token, {
                            action: "profile",
                            name: " 가상 새 신청자 ",
                            email: contacts.dh.email,
                        });
                        assert.equal(value.data.name, "가상 새 신청자");
                        assert.equal(value.data.identified, false);
                        const detail = (await api(key, a.token)).data;
                        assert.equal(detail.messages[0].body, "가상 기존 문의");
                        assert.equal(detail.profile.email, contacts.dh.email);
                        assert.equal(detail.profile.identified, false);
                        const [chat] = await db
                            .select()
                            .from(s.inboxConversations)
                            .where(eq(s.inboxConversations.id, a.id));
                        assert.equal(chat.contactId, null);
                        assert.equal(chat.recordId, null);
                        assert.equal(chat.version, 2);
                    },
                );
                await check(
                    "입력 변경 감사와 outbox가 남고 같은 재시도는 중복 변경 없음",
                    async () => {
                        const audit = await inboxAuditPage(
                            actor.orgId,
                            channels.dh.id,
                            a.id,
                            undefined,
                            db,
                        );
                        assert.equal(audit.rows.length, 1);
                        assert.equal(
                            audit.rows[0].action,
                            "visitor.profile.updated",
                        );
                        assert.equal(
                            audit.rows[0].changes.name.before,
                            "가상 이전 이름",
                        );
                        const events = await db
                            .select()
                            .from(s.platformEvents)
                            .where(
                                eq(
                                    s.platformEvents.type,
                                    "conversation.updated",
                                ),
                            );
                        assert.ok(
                            events.some(
                                (event) =>
                                    event.payload.data.conversationId ===
                                        a.id &&
                                    event.payload.data.action ===
                                        "visitor.profile.updated",
                            ),
                        );
                        await api(key, a.token, {
                            action: "profile",
                            name: "가상 새 신청자",
                            email: contacts.dh.email,
                        });
                        const next = await inboxAuditPage(
                            actor.orgId,
                            channels.dh.id,
                            a.id,
                            undefined,
                            db,
                        );
                        assert.equal(next.rows.length, 1);
                    },
                );
                await check(
                    "이메일 생략은 보존, 빈 이메일은 지우며 다음 메시지 이름 갱신",
                    async () => {
                        const preserved = await api(key, a.token, {
                            action: "profile",
                            name: "가상 새 신청자",
                        });
                        assert.equal(preserved.data.email, contacts.dh.email);
                        await api(key, a.token, {
                            action: "profile",
                            name: "가상 새 신청자",
                            email: "",
                        });
                        await repo.sendVisitorMessage(
                            key,
                            a.token,
                            { clientId: randomUUID(), body: "가상 후속 문의" },
                            db,
                        );
                        const detail = (await api(key, a.token)).data;
                        assert.equal(detail.profile.email, null);
                        assert.equal(
                            detail.messages.at(-1).authorName,
                            "가상 새 신청자",
                        );
                    },
                );
                await check(
                    "증명 없음·다른 사업 증명·미허용 origin 차단",
                    async () => {
                        const body = { action: "profile", name: "가상 변경" };
                        await api(key, "", body, 401);
                        await api(
                            channels.bo.publicKey,
                            a.token,
                            body,
                            401,
                            "http://127.0.0.1:3123",
                        );
                        await api(
                            key,
                            a.token,
                            body,
                            403,
                            "https://outside.example.test",
                        );
                    },
                );
                await check(
                    "회원 인증은 프로필 변경 불가, CRM 정보도 변경 없음",
                    async () => {
                        const auth = await clients.dh.customerIdentity(
                            channels.dh.id,
                            contacts.dh.id,
                        );
                        await api(
                            key,
                            auth.identityToken,
                            { action: "profile", name: "가상 위조" },
                            401,
                        );
                        const [contact] = await db
                            .select()
                            .from(s.crmContacts)
                            .where(eq(s.crmContacts.id, contacts.dh.id));
                        assert.equal(contact.name, contacts.dh.name);
                    },
                );
                await check(
                    "추가 uid/고객 번호·잘못된 이메일·긴 이름은 거절",
                    async () => {
                        await api(
                            key,
                            a.token,
                            {
                                action: "profile",
                                name: "가상",
                                contactId: contacts.dh.id,
                            },
                            400,
                        );
                        await api(
                            key,
                            a.token,
                            { action: "profile", name: "가상", email: "wrong" },
                            400,
                        );
                        await api(
                            key,
                            a.token,
                            { action: "profile", name: "a".repeat(101) },
                            400,
                        );
                    },
                );
                await check(
                    "회원에게 연결된 옛 익명 증명으로는 변경 불가",
                    async () => {
                        const b = await repo.startVisitorSession(
                            key,
                            { name: "가상 연결 전" },
                            db,
                        );
                        const auth = await clients.dh.customerIdentity(
                            channels.dh.id,
                            contacts.dh.id,
                        );
                        await api(key, auth.identityToken, {
                            action: "identify",
                            anonymousToken: b.token,
                        });
                        await api(
                            key,
                            b.token,
                            { action: "profile", name: "가상 위조" },
                            401,
                        );
                    },
                );
                await check("꺼진 채널은 입력 변경 불가", async () => {
                    await db
                        .update(s.inboxChannels)
                        .set({ enabled: false })
                        .where(eq(s.inboxChannels.id, channels.dh.id));
                    await api(
                        key,
                        a.token,
                        { action: "profile", name: "가상" },
                        404,
                    );
                });
                console.log(
                    "비회원 입력 정보 SQL/API QA " +
                        count +
                        "개 통과 · 실제 발송 0건",
                );
            } catch (error) {
                throw error;
            }
            await pg.close();
        },
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
