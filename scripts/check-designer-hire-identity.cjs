/* eslint-disable @typescript-eslint/no-require-imports -- 격리 CommonJS fixture와 외부 서버 컴파일 결과를 주입하는 교차 저장소 QA */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
const path = require("node:path");
const serverDirectory = process.argv[2];
if (!serverDirectory || !path.isAbsolute(serverDirectory))
    throw new Error(
        "컴파일한 designer-hire-server의 절대 경로를 인자로 전달해주세요.",
    );
const { issueSupportIdentity } = require(
    path.join(serverDirectory, "lib-test/customer-support/sendb.js"),
);
runPlatformCheck(async (ctx) => {
    const { db, pg, keys, channels, dispatch } = ctx;
    const schema = require("../src/lib/db/schema.ts"),
        { and, eq, sql } = require("drizzle-orm");
    const uid = "firebase-verified-member",
        member = {
            name: "가상 Firebase 고객",
            email: "firebase-member@example.test",
            companyName: "가상 Firebase 기업",
            userType: "client",
        };
    const config = (name = "dh") => ({
        apiBase: "http://127.0.0.1:3120",
        apiToken: keys[name],
        workspaceId: name === "bo" ? 10 : 8,
        channelId: channels[name === "bo" ? "bo" : "dh"].id,
        allowedOrigins: ["http://127.0.0.1:3122"],
    });
    const contacts = (workspaceId) =>
        db
            .select()
            .from(schema.crmContacts)
            .where(
                and(
                    eq(schema.crmContacts.workspaceId, workspaceId),
                    eq(schema.crmContacts.externalId, uid),
                ),
            );
    let checks = 0;
    async function check(title, fn) {
        await fn();
        console.log("PASS SITE IDENTITY " + ++checks + " " + title);
    }
    let dhIdentity, boIdentity;

    await check(
        "실제 고객 API upsert·회원 JWT 발급·프로필 읽기, 빈 상담 생성 없음",
        async () => {
            const before = await db
                .select({ n: sql`count(*)` })
                .from(schema.inboxConversations);
            dhIdentity = await issueSupportIdentity(
                config(),
                uid,
                member,
                dispatch,
            );
            assert.equal(dhIdentity.channelKey, channels.dh.publicKey);
            const result = await dispatch(
                "http://127.0.0.1:3120/api/messenger/" + channels.dh.publicKey,
                {
                    headers: {
                        Authorization: "Bearer " + dhIdentity.identityToken,
                    },
                },
            );
            assert.equal(result.status, 200);
            assert.equal((await result.json()).data.profile.name, member.name);
            assert.deepEqual(
                await db
                    .select({ n: sql`count(*)` })
                    .from(schema.inboxConversations),
                before,
            );
            const [contact] = await contacts(8);
            assert.equal(contact.externalId, uid);
            assert.equal(contact.attributes.companyName, member.companyName);
        },
    );
    await check(
        "인증 갱신은 같은 고객을 재사용하고 JWT만 새로 발급",
        async () => {
            const [before] = await contacts(8),
                refreshed = await issueSupportIdentity(
                    config(),
                    uid,
                    member,
                    dispatch,
                ),
                after = await contacts(8);
            assert.equal(after.length, 1);
            assert.equal(after[0].id, before.id);
            assert.notEqual(refreshed.identityToken, dhIdentity.identityToken);
        },
    );
    await check(
        "다른 사업에 같은 Firebase uid가 있어도 고객·채널 JWT가 격리",
        async () => {
            boIdentity = await issueSupportIdentity(
                config("bo"),
                uid,
                { ...member, name: "가상 백오랩 Firebase 고객" },
                dispatch,
            );
            const [dh] = await contacts(8),
                [bo] = await contacts(10);
            assert.notEqual(dh.id, bo.id);
            const result = await dispatch(
                "http://127.0.0.1:3120/api/messenger/" + channels.dh.publicKey,
                {
                    headers: {
                        Authorization: "Bearer " + boIdentity.identityToken,
                    },
                },
            );
            assert.equal(result.status, 401);
        },
    );
    await check("읽기 전용 서비스 키는 고객 생성·인증 발급 불가", async () => {
        await assert.rejects(
            issueSupportIdentity(
                { ...config(), apiToken: keys.read },
                "firebase-denied-member",
                member,
                dispatch,
            ),
        );
        const found = await db
            .select()
            .from(schema.crmContacts)
            .where(eq(schema.crmContacts.externalId, "firebase-denied-member"));
        assert.equal(found.length, 0);
    });
    await check("사업 범위 밖 채널을 설정하면 인증 발급 거절", async () => {
        await assert.rejects(
            issueSupportIdentity(
                { ...config(), channelId: channels.bo.id },
                uid,
                member,
                dispatch,
            ),
        );
    });
    await check(
        "발급한 회원 인증으로 실제 문의가 동일 고객의 인박스에 저장",
        async () => {
            const clientId = randomUUID(),
                response = await dispatch(
                    "http://127.0.0.1:3120/api/messenger/" +
                        channels.dh.publicKey,
                    {
                        method: "POST",
                        headers: {
                            Authorization: "Bearer " + dhIdentity.identityToken,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            clientId,
                            body: "가상 Firebase 회원의 실제 격리 API 문의",
                        }),
                    },
                );
            assert.equal(response.status, 200);
            const [contact] = await contacts(8),
                [conversation] = await db
                    .select()
                    .from(schema.inboxConversations)
                    .where(eq(schema.inboxConversations.contactId, contact.id));
            assert.equal(conversation.channelId, channels.dh.id);
            const [message] = await db
                .select()
                .from(schema.inboxMessages)
                .where(eq(schema.inboxMessages.clientId, clientId));
            assert.equal(message.conversationId, conversation.id);
        },
    );
    await check(
        "보관은 계정 정지가 아니며 같은 회원 상담을 유지하고 CRM은 자동 복구하지 않음",
        async () => {
            const [contact] = await contacts(8);
            await db
                .update(schema.crmContacts)
                .set({
                    archivedAt: new Date(),
                    version: sql`${schema.crmContacts.version}+1`,
                })
                .where(eq(schema.crmContacts.id, contact.id));
            const restoredIdentity = await issueSupportIdentity(
                config(),
                uid,
                member,
                dispatch,
            );
            assert.ok((await contacts(8))[0].archivedAt);
            assert.equal((await contacts(8))[0].id, contact.id);
            const response = await dispatch(
                "http://127.0.0.1:3120/api/messenger/" + channels.dh.publicKey,
                {
                    headers: {
                        Authorization:
                            "Bearer " + restoredIdentity.identityToken,
                    },
                },
            );
            assert.equal(response.status, 200);
            assert.equal(
                (await response.json()).data.messages.at(-1).body,
                "가상 Firebase 회원의 실제 격리 API 문의",
            );
        },
    );
    await check("꺼진 사업 상담창은 회원 인증을 발급하지 않음", async () => {
        await db
            .update(schema.inboxChannels)
            .set({ enabled: false })
            .where(eq(schema.inboxChannels.id, channels.bo.id));
        await assert.rejects(
            issueSupportIdentity(config("bo"), uid, member, dispatch),
        );
    });
    console.log(
        "디하 서버→샌드비 SQL/API 통합 QA " +
            checks +
            "개 통과 · 가상 Firebase·PGlite만 사용 · 실제 외부 전송 0건",
    );
    await pg.close();
}).catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
