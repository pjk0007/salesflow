/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runMessengerCheck(extra) {
    return runPlatformCheck(async (ctx) => {
        const s = require("../src/lib/db/schema.ts"),
            { eq, and } = require("drizzle-orm");
        const inbox = require("../src/lib/inbox/repository.ts"),
            {
                customerReplyContact: contact,
            } = require("../src/lib/customer-messenger/contact.ts"),
            {
                processCustomerReplyNotifications: worker,
            } = require("../src/lib/customer-messenger/worker.ts");
        const env = {
            NODE_ENV: process.env.NODE_ENV,
            CUSTOMER_REPLY_NOTIFICATIONS:
                process.env.CUSTOMER_REPLY_NOTIFICATIONS,
        };
        process.env.NODE_ENV = "production";
        process.env.CUSTOMER_REPLY_NOTIFICATIONS = "on";
        const mails = [];
        const send = async (mail) => {
            mails.push(mail);
            return "fixture-" + randomUUID();
        };
        const now = new Date(),
            future = new Date(now.getTime() + 180000);
        let checks = 0;
        const pass = (name) => {
            checks++;
            console.log(`PASS CUSTOMER MESSENGER ${checks} ${name}`);
        };
        try {
            await ctx.db.insert(s.emailConfigs).values({
                orgId: ctx.actor.orgId,
                appKey: "fixture-only",
                secretKey: "fixture-only",
                fromEmail: "sender@example.test",
            });
            await ctx.db
                .update(s.inboxChannels)
                .set({
                    allowedOrigins: [
                        "https://designer-hire.com",
                        ...ctx.channels.dh.allowedOrigins,
                    ],
                    messengerSettings: {
                        enabled: true,
                        tagline: "시간제 전담 디자이너 구독, 디하",
                        consultationUrl:
                            "https://designer-hire.com/consulting/",
                        emailNotifications: true,
                    },
                })
                .where(eq(s.inboxChannels.id, ctx.channels.dh.id));
            const a = await inbox.startVisitorSession(
                ctx.channels.dh.publicKey,
                { name: "가상 연락처 QA" },
                ctx.db,
            );
            const saved = await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                {
                    action: "contact",
                    name: "가상 회사",
                    phone: "010-0000-0000",
                    email: "visitor@example.test",
                    notifyEmail: true,
                },
                ctx.db,
                send,
                now,
            );
            assert.equal(saved.verified, false);
            assert.equal(saved.phone, "010-0000-0000");
            const [chat] = await ctx.db
                .select()
                .from(s.inboxConversations)
                .where(eq(s.inboxConversations.id, a.id));
            assert.equal(chat.contactId, null);
            assert.equal(chat.identifiedAt, null);
            pass(
                "연락처 저장은 현재 비회원 문의에만 붙고 CRM 본인으로 승격하지 않음",
            );
            await assert.rejects(
                contact(
                    ctx.channels.bo.publicKey,
                    a.token,
                    a.id,
                    undefined,
                    ctx.db,
                ),
                /상담/,
            );
            pass("다른 사업·다른 상담 토큰으로 연락처 열람 차단");
            await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                { action: "send-code" },
                ctx.db,
                send,
                now,
            );
            assert.equal(mails.length, 1);
            const code = mails[0].body.match(/<strong>(\d{6})<\/strong>/)[1];
            await assert.rejects(
                contact(
                    ctx.channels.dh.publicKey,
                    a.token,
                    a.id,
                    { action: "send-code" },
                    ctx.db,
                    send,
                    now,
                ),
                /1분/,
            );
            pass("인증 메일 실제 전송 대신 격리 운송 검사 · 재요청 간격 적용");
            for (let i = 0; i < 5; i++)
                await assert.rejects(
                    contact(
                        ctx.channels.dh.publicKey,
                        a.token,
                        a.id,
                        {
                            action: "verify-code",
                            code: code === "000000" ? "111111" : "000000",
                        },
                        ctx.db,
                        send,
                        now,
                    ),
                    /인증번호/,
                );
            await assert.rejects(
                contact(
                    ctx.channels.dh.publicKey,
                    a.token,
                    a.id,
                    { action: "verify-code", code },
                    ctx.db,
                    send,
                    now,
                ),
                /인증번호/,
            );
            pass("틀린 인증 시도는 롤백되지 않고 5회 제한");
            const later = new Date(now.getTime() + 61000);
            await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                { action: "send-code" },
                ctx.db,
                send,
                later,
            );
            const code2 = mails
                .at(-1)
                .body.match(/<strong>(\d{6})<\/strong>/)[1];
            assert.deepEqual(
                await contact(
                    ctx.channels.dh.publicKey,
                    a.token,
                    a.id,
                    { action: "verify-code", code: code2 },
                    ctx.db,
                    send,
                    later,
                ),
                { verified: true },
            );
            pass("인증한 본인 이메일에만 답변 알림 허용");
            const clientId = randomUUID();
            await ctx.clients.dh.reply(a.id, "가상 답변 첫 번째", clientId);
            await ctx.clients.dh.reply(a.id, "가상 답변 첫 번째", clientId);
            let jobs = await ctx.db
                .select()
                .from(s.customerReplyNotifications)
                .where(eq(s.customerReplyNotifications.conversationId, a.id));
            assert.equal(jobs.length, 1);
            await worker(ctx.db, send, new Date(now.getTime() + 60000));
            assert.equal(mails.length, 2);
            pass("중복 답변 요청은 알림 한 건만 예약 · 대기 중 조기 발송 없음");
            await worker(ctx.db, send, future);
            assert.equal(mails.length, 3);
            assert(!mails.at(-1).body.includes("가상 답변 첫 번째"));
            assert(!mails.at(-1).body.includes(a.token));
            await worker(ctx.db, send, future);
            assert.equal(mails.length, 3);
            pass(
                "읽지 않은 답변 한 번 알림 · 대화 본문·첨부·인증 토큰은 이메일에서 제외",
            );
            await ctx.clients.dh.reply(a.id, "가상 읽음 검수", randomUUID());
            const [readJob] = await ctx.db
                .select()
                .from(s.customerReplyNotifications)
                .where(
                    and(
                        eq(s.customerReplyNotifications.conversationId, a.id),
                        eq(s.customerReplyNotifications.state, "pending"),
                    ),
                );
            await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                { action: "seen", messageId: readJob.messageId },
                ctx.db,
                send,
                now,
            );
            await worker(ctx.db, send, future);
            assert.equal(mails.length, 3);
            pass("상담창에서 이미 읽은 답변은 이메일 알림 취소");
            await ctx.clients.dh.reply(
                a.id,
                "가상 동의 해제 검수",
                randomUUID(),
            );
            await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                {
                    action: "contact",
                    name: "가상 회사",
                    phone: "010-0000-0000",
                    email: "visitor@example.test",
                    notifyEmail: false,
                },
                ctx.db,
                send,
                now,
            );
            await worker(ctx.db, send, future);
            assert.equal(mails.length, 3);
            pass("동의 해제와 연락처 버전 변경은 기존 예약 발송을 중단");
            await contact(
                ctx.channels.dh.publicKey,
                a.token,
                a.id,
                {
                    action: "contact",
                    name: "가상 회사",
                    email: "visitor@example.test",
                    notifyEmail: true,
                },
                ctx.db,
                send,
                now,
            );
            await ctx.clients.dh.reply(a.id, "가상 연속 답변1", randomUUID());
            await ctx.clients.dh.reply(a.id, "가상 연속 답변2", randomUUID());
            await worker(ctx.db, send, future);
            assert.equal(mails.length, 4);
            pass("연달아 온 답변은 최신 답변 알림으로 합쳐 발송");
            await ctx.clients.dh.reply(
                a.id,
                "가상 운송 불확실성",
                randomUUID(),
            );
            let attempts = 0;
            const uncertain = async () => {
                attempts++;
                throw Error("fixture timeout");
            };
            await worker(ctx.db, uncertain, future);
            await worker(
                ctx.db,
                uncertain,
                new Date(future.getTime() + 600000),
            );
            assert.equal(attempts, 1);
            pass("발송 결과가 불확실하면 자동 재전송하지 않아 중복 알림 방지");
            const before = await ctx.db.select().from(s.customerReplyContacts);
            for (let i = 0; i < 2; i++)
                for (const q of fs
                    .readFileSync(
                        __dirname +
                            "/../drizzle/0116_customer_messenger_contact.sql",
                        "utf8",
                    )
                    .split("--> statement-breakpoint"))
                    if (q.trim()) await ctx.pg.exec(q);
            assert.equal(
                (await ctx.db.select().from(s.customerReplyContacts)).length,
                before.length,
            );
            pass("추가 마이그레이션을 재실행해도 기존 연락처·상담 유지");
            const contactUrl = `http://localhost/api/messenger/${ctx.channels.dh.publicKey}/contact?conversationId=${a.id}`;
            assert.equal((await ctx.dispatch(contactUrl)).status, 401);
            const own = await ctx.dispatch(contactUrl, {
                headers: { Authorization: `Bearer ${a.token}` },
            });
            assert.equal(own.status, 200);
            const ownData = await own.json();
            assert.equal(ownData.data.email, "visitor@example.test");
            assert(!JSON.stringify(ownData).includes("verificationHash"));
            pass(
                "공개 연락처 API는 인증된 현재 문의만 반환하고 인증 비밀은 제외",
            );
            const foreign = await ctx.dispatch(contactUrl, {
                headers: {
                    Origin: "https://unrelated.example.test",
                    Authorization: `Bearer ${a.token}`,
                },
            });
            assert.equal(foreign.status, 403);
            pass("새 연락처 API도 설치 도메인과 CORS 경계를 유지");
            console.log(
                JSON.stringify({
                    status: "customer_messenger_qa_passed",
                    checks,
                    realExternalMessages: 0,
                    productionDbConnections: 0,
                }),
            );
            if (extra)
                await extra({ ...ctx, fakeSend: send, fakeMails: mails });
            else await ctx.pg.close();
        } finally {
            for (const [key, value] of Object.entries(env))
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
        }
    });
}
if (require.main === module)
    runMessengerCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runMessengerCheck };
