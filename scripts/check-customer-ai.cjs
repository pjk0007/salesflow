/* eslint-disable @typescript-eslint/no-require-imports -- 격리 SQL·가상 모델 응답으로만 상담 AI 검증 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runAiCheck(extra) {
    return runPlatformCheck(async (ctx) => {
        const { db, pg, actor, repo, clients, channels, aiTest } = ctx,
            s = require("../src/lib/db/schema.ts"),
            { eq, and } = require("drizzle-orm");
        const { queueSupportJob } = require("../src/lib/customer-ai/queue.ts"),
            { processSupportJob } = require("../src/lib/customer-ai/worker.ts"),
            { recordSupportUsage } = require("../src/lib/customer-ai/usage.ts");
        let checks = 0,
            callCount = 0;
        const check = async (name, fn) => {
            await fn();
            console.log(`PASS AI ${++checks} ${name}`);
        };
        const fact =
            "디자인 구독은 월 150,000원이며 작업 요청은 3개까지 가능합니다.";
        const fakeCall = async (_config, prompt) => {
            callCount++;
            const data = JSON.parse(prompt.user);
            return {
                content: JSON.stringify(
                    data.answer
                        ? {
                              supported: true,
                              confidence: 0.98,
                              unsupportedClaims: [],
                          }
                        : {
                              decision: "answer",
                              answer: fact,
                              confidence: 0.98,
                              reason: "승인 근거",
                              citations: [
                                  {
                                      sourceId: data.sources[0].id,
                                      quote: data.sources[0].text,
                                  },
                              ],
                          },
                ),
                promptTokens: 100,
                completionTokens: 30,
                truncated: false,
            };
        };
        const deps = {
            now: () => new Date(Date.now() + 20000),
            quota: async () => true,
            call: fakeCall,
            timeoutMs: 100,
        };
        aiTest.configured = true;
        aiTest.deps = deps;
        const knowledge = await clients.dh.createSupportKnowledge(
            8,
            "가상 디자인 구독 FAQ",
            {
                businessName: "가상 디하",
                claims: [
                    {
                        text: fact,
                        sourceUrl: "https://example.test/design-faq",
                        checkedAt: new Date(Date.now() - 1000).toISOString(),
                        purposes: ["customer_chat"],
                    },
                    {
                        text: "이 항목은 메일에서만 사용하는 문구입니다.",
                        sourceUrl: "https://example.test/mail",
                        checkedAt: new Date(Date.now() - 1000).toISOString(),
                        purposes: ["initial_email"],
                    },
                ],
            },
        );
        await clients.dh.reviewSupportKnowledge(8, knowledge.id, "approve");
        async function settings(patch = {}) {
            const c = await clients.dh.supportAiSettings(8);
            return clients.dh.updateSupportAiSettings(8, {
                ...c.settings,
                knowledgeVersionId: knowledge.id,
                handoffAssigneeId: actor.userId,
                ...patch,
            });
        }
        await settings();
        async function chat(body = "디자인 구독 요금이 궁금합니다.") {
            const session = await repo.startVisitorSession(
                channels.dh.publicKey,
                { name: "가상 AI 고객" },
                db,
            );
            await repo.sendVisitorMessage(
                channels.dh.publicKey,
                session.token,
                { clientId: randomUUID(), body },
                db,
            );
            return { id: session.id, token: session.token };
        }
        async function message(c, body) {
            return repo.sendVisitorMessage(
                channels.dh.publicKey,
                c.token,
                { clientId: randomUUID(), body },
                db,
            );
        }
        async function row(id) {
            return (
                await db
                    .select()
                    .from(s.customerAiJobs)
                    .where(eq(s.customerAiJobs.id, id))
            )[0];
        }
        async function latest(c) {
            return (
                await db
                    .select()
                    .from(s.customerAiJobs)
                    .where(eq(s.customerAiJobs.conversationId, c.id))
                    .orderBy(
                        require("drizzle-orm").desc(s.customerAiJobs.createdAt),
                    )
            )[0];
        }
        async function manual(c) {
            const { jobId } = await clients.dh.generateSupportDraft(
                c.id,
                randomUUID(),
            );
            return row(jobId);
        }
        await check(
            "승인 지식·사업 범위·수정 버전 CAS·메일 근거 제외",
            async () => {
                const c = await clients.dh.supportAiSettings(8);
                assert.equal(c.knowledge[0].claims, 1);
                await assert.rejects(
                    () =>
                        clients.bo.reviewSupportKnowledge(
                            10,
                            knowledge.id,
                            "approve",
                        ),
                    (e) => e.status === 404,
                );
                await assert.rejects(
                    () => clients.read.updateSupportAiSettings(8, c.settings),
                    (e) => e.status === 403,
                );
                await assert.rejects(
                    () =>
                        clients.dh.updateSupportAiSettings(8, {
                            ...c.settings,
                            version: 0,
                        }),
                    (e) => e.status === 409,
                );
            },
        );
        let first, firstJob;
        await check(
            "수동 초안·2단계 모델 검토·내부 메모 제외·전송 전 무응답",
            async () => {
                first = await chat();
                await clients.dh.reply(
                    first.id,
                    "절대 고객에게 보내면 안 되는 내부 메모",
                    randomUUID(),
                    "note",
                );
                firstJob = await manual(first);
                assert.equal(firstJob.state, "ready");
                assert.equal(
                    firstJob.context.messages.some((m) => m.kind === "note"),
                    false,
                );
                assert.equal(firstJob.sources.length, 1);
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    first.token,
                    db,
                );
                assert.equal(
                    view.messages.filter((m) => m.kind === "reply").length,
                    0,
                );
                assert.equal(
                    (await clients.dh.supportDraft(first.id, firstJob.id))
                        .usable,
                    true,
                );
            },
        );
        await check(
            "사람이 수정 후 전송·초안 한 번 사용·공개 DTO 비공개 정보 제외",
            async () => {
                const clientId = randomUUID();
                await clients.dh.reply(
                    first.id,
                    firstJob.answer + " 자세히 안내드릴게요.",
                    clientId,
                    "reply",
                    [],
                    firstJob.id,
                );
                await clients.dh.reply(
                    first.id,
                    firstJob.answer + " 자세히 안내드릴게요.",
                    clientId,
                    "reply",
                    [],
                    firstJob.id,
                );
                assert.equal((await row(firstJob.id)).state, "sent");
                await assert.rejects(
                    () =>
                        clients.dh.reply(
                            first.id,
                            "중복",
                            randomUUID(),
                            "reply",
                            [],
                            firstJob.id,
                        ),
                    (e) => e.status === 409,
                );
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    first.token,
                    db,
                );
                assert.equal(
                    view.messages.filter((m) => m.kind === "reply").length,
                    1,
                );
                assert.ok(!JSON.stringify(view).includes("aiDraftId"));
                assert.equal(view.aiState, "human");
            },
        );
        await check("새 문의가 도착하면 기존 초안은 전송 불가", async () => {
            const c = await chat(),
                job = await manual(c);
            await message(c, "요금 질문을 수정합니다.");
            assert.equal((await row(job.id)).state, "stale");
            await assert.rejects(
                () =>
                    clients.dh.reply(
                        c.id,
                        job.answer,
                        randomUUID(),
                        "reply",
                        [],
                        job.id,
                    ),
                (e) => e.status === 409,
            );
        });
        await check("자동 초안은 워커 생성 후 상담원 전송 대기", async () => {
            await settings({ mode: "draft" });
            const c = await chat(),
                job = await latest(c);
            assert.equal(job.state, "queued");
            await processSupportJob(job.id, { exec: db, deps });
            assert.equal((await row(job.id)).state, "ready");
            const view = await repo.visitorDetail(
                channels.dh.publicKey,
                c.token,
                db,
            );
            assert.equal(
                view.messages.filter((m) => m.kind === "reply").length,
                0,
            );
        });
        await check(
            "자동 답변·AI 작성 표시·재시도에도 한 번만 전송",
            async () => {
                await settings({ mode: "reply" });
                const c = await chat(),
                    job = await latest(c);
                await processSupportJob(job.id, { exec: db, deps });
                await processSupportJob(job.id, { exec: db, deps });
                assert.equal((await row(job.id)).state, "sent");
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    c.token,
                    db,
                );
                const replies = view.messages.filter((m) => m.kind === "reply");
                assert.equal(replies.length, 1);
                assert.equal(replies[0].authorName, "AI 상담 도우미");
            },
        );
        await check(
            "고객의 사람 요청은 모델 호출 없이 담당 배정·반복 안내 방지",
            async () => {
                const count = callCount,
                    c = await chat("상담원 연결을 부탁드립니다.");
                await message(c, "담당자 연결해주세요");
                assert.equal(callCount, count);
                const view = await repo.visitorDetail(
                    channels.dh.publicKey,
                    c.token,
                    db,
                );
                assert.equal(view.aiState, "human");
                assert.equal(
                    view.messages.filter((m) => m.kind === "reply").length,
                    1,
                );
                const detail = await repo.conversationDetail(actor, c.id, db);
                assert.equal(detail.conversation.assigneeId, actor.userId);
                const events = await db
                    .select()
                    .from(s.platformEvents)
                    .where(
                        and(
                            eq(s.platformEvents.workspaceId, 8),
                            eq(s.platformEvents.type, "ai.handoff"),
                        ),
                    );
                assert.equal(
                    events.filter((e) => e.payload.data.conversationId === c.id)
                        .length,
                    1,
                );
                assert.ok(
                    !JSON.stringify(
                        events.filter(
                            (e) => e.payload.data.conversationId === c.id,
                        ).map(e=>e.payload),
                    ).includes("aiHandoffReason"),
                );
                await message(c, "디자인 구독 요금 질문입니다.");
                assert.equal(await latest(c), undefined);
            },
        );
        await check(
            "자료 없는 질문·환각 수치·판정 실패·모델 오류는 사람에게 인계",
            async () => {
                for (const [question, call] of [
                    ["zzzzzz", fakeCall],
                    [
                        "디자인 구독 요금",
                        async (...args) => {
                            const res = await fakeCall(...args),
                                obj = JSON.parse(res.content);
                            if (obj.answer) obj.answer = "월 5원입니다.";
                            return { ...res, content: JSON.stringify(obj) };
                        },
                    ],
                    [
                        "디자인 구독 요금",
                        async (config, prompt) =>
                            JSON.parse(prompt.user).answer
                                ? {
                                      content: JSON.stringify({
                                          supported: false,
                                          confidence: 0.98,
                                          unsupportedClaims: ["없는 약속"],
                                      }),
                                      promptTokens: 10,
                                      completionTokens: 10,
                                      truncated: false,
                                  }
                                : fakeCall(config, prompt),
                    ],
                    [
                        "디자인 구독 요금",
                        async () => {
                            throw new Error("fake provider failure");
                        },
                    ],
                ]) {
                    const c = await chat(question),
                        job = await latest(c);
                    await processSupportJob(job.id, {
                        exec: db,
                        deps: { ...deps, call },
                    });
                    assert.equal((await row(job.id)).state, "handed_off");
                    assert.equal(
                        (
                            await repo.visitorDetail(
                                channels.dh.publicKey,
                                c.token,
                                db,
                            )
                        ).aiState,
                        "human",
                    );
                }
            },
        );
        await check(
            "생성 도중 상담원 답변·새 고객 문의·설정 변경·취소는 늦은 전송 차단",
            async () => {
                for (const action of [
                    "reply",
                    "customer",
                    "settings",
                    "cancel",
                ]) {
                    const c = await chat(),
                        job = await latest(c);
                    let resolve, started;
                    const entered = new Promise((r) => (started = r)),
                        pending = new Promise((r) => (resolve = r));
                    const running = processSupportJob(job.id, {
                        exec: db,
                        deps: {
                            ...deps,
                            timeoutMs: 1000,
                            call: async (config, prompt) => {
                                started();
                                await pending;
                                return fakeCall(config, prompt);
                            },
                        },
                    });
                    await entered;
                    if (action === "reply")
                        await clients.dh.reply(
                            c.id,
                            "사람이 확인하고 안내드리겠습니다.",
                            randomUUID(),
                        );
                    if (action === "customer")
                        await message(c, "새 질문이 있어요.");
                    if (action === "settings") await settings();
                    if (action === "cancel")
                        await clients.dh.cancelSupportDraft(c.id, job.id);
                    resolve();
                    await running;
                    assert.ok(
                        ["stale", "cancelled"].includes(
                            (await row(job.id)).state,
                        ),
                    );
                    const view = await repo.visitorDetail(
                        channels.dh.publicKey,
                        c.token,
                        db,
                    );
                    assert.equal(
                        view.messages.filter(
                            (m) => m.authorName === "AI 상담 도우미",
                        ).length,
                        0,
                    );
                }
            },
        );
        await check(
            "공유 사용량 부족·사업 일일 한도는 모델 호출 없이 인계",
            async () => {
                const c = await chat(),
                    job = await latest(c),
                    count = callCount;
                await processSupportJob(job.id, {
                    exec: db,
                    deps: { ...deps, quota: async () => false },
                });
                assert.equal(callCount, count);
                assert.equal((await row(job.id)).state, "handed_off");
                await settings({ maxJobsPerDay: 1 });
                const d = await chat(),
                    dailyJob = await latest(d);
                await processSupportJob(dailyJob.id, { exec: db, deps });
                assert.equal(callCount, count);
                assert.equal((await row(dailyJob.id)).state, "handed_off");
                await settings({ maxJobsPerDay: 1000 });
            },
        );
        await check(
            "타 사업·읽기 토큰은 생성/취소할 수 없고 생성 기록도 격리",
            async () => {
                const c = await chat(),
                    job = await latest(c);
                await assert.rejects(
                    () => clients.bo.supportDraft(c.id, job.id),
                    (e) => e.status === 404 || e.status === 403,
                );
                await assert.rejects(
                    () => clients.read.generateSupportDraft(c.id, randomUUID()),
                    (e) => e.status === 403,
                );
                await assert.rejects(
                    () => clients.read.cancelSupportDraft(c.id, job.id),
                    (e) => e.status === 403,
                );
                await db
                    .insert(s.customerAiJobs)
                    .values(
                        Array.from({ length: 55 }, () => ({
                            ...job,
                            id: randomUUID(),
                            clientId: randomUUID(),
                            state: "cancelled",
                            createdAt: new Date("2020-01-01"),
                        })),
                    );
                const page = await clients.dh.supportDrafts(c.id),
                    next = await clients.dh.supportDrafts(
                        c.id,
                        page.rows.at(-1).id,
                    );
                assert.equal(
                    new Set([...page.rows, ...next.rows].map((j) => j.id)).size,
                    56,
                );
                assert.ok(
                    page.rows.every(
                        (j) =>
                            !("context" in j) &&
                            !("sources" in j) &&
                            !("answer" in j),
                    ),
                );
            },
        );
        await check(
            "시간 초과 후 늦은 사용량은 한 번만 집계·답변은 채택 안 함",
            async () => {
                const c = await chat(),
                    job = await latest(c);
                let resolve;
                const late = new Promise((r) => (resolve = r));
                await processSupportJob(job.id, {
                    exec: db,
                    deps: { ...deps, timeoutMs: 5, call: () => late },
                });
                assert.equal((await row(job.id)).state, "handed_off");
                const [call] = await db
                    .select()
                    .from(s.customerAiCalls)
                    .where(eq(s.customerAiCalls.jobId, job.id));
                const before = (
                    await db
                        .select()
                        .from(s.aiUsageQuotas)
                        .where(eq(s.aiUsageQuotas.orgId, actor.orgId))
                )[0].totalTokens;
                const response = {
                    content: "ignored late answer",
                    promptTokens: 12,
                    completionTokens: 8,
                    truncated: false,
                };
                resolve(response);
                await new Promise((r) => setTimeout(r, 50));
                await recordSupportUsage(db, call.id, response, true);
                const after = (
                    await db
                        .select()
                        .from(s.aiUsageQuotas)
                        .where(eq(s.aiUsageQuotas.orgId, actor.orgId))
                )[0].totalTokens;
                assert.equal(after - before, 20);
                assert.equal((await row(job.id)).state, "handed_off");
            },
        );
        await check(
            "끊긴 워커는 두 번까지만 복구하고 이후 사람에게 인계",
            async () => {
                const c = await chat(),
                    job = await latest(c);
                await db
                    .update(s.customerAiJobs)
                    .set({
                        state: "generating",
                        attempts: 2,
                        leaseId: randomUUID(),
                        leaseUntil: new Date("2000-01-01"),
                    })
                    .where(eq(s.customerAiJobs.id, job.id));
                const count = callCount;
                await processSupportJob(job.id, { exec: db, deps });
                assert.equal(callCount, count);
                assert.equal((await row(job.id)).state, "handed_off");
            },
        );
        await check(
            "첨부 자료·사람 응대 재개·자동 생성 지연·멱등 생성",
            async () => {
                await settings({ mode: "reply" });
                const c = await chat(),
                    job = await latest(c),
                    before = Date.now();
                assert.ok(job.eligibleAt.getTime() > before + 5000);
                assert.equal(
                    await processSupportJob(job.id, {
                        exec: db,
                        deps: { ...deps, now: () => new Date() },
                    }),
                    null,
                );
                const duplicate = await queueSupportJob(
                    undefined,
                    c.id,
                    job.clientId,
                    db,
                );
                assert.equal(duplicate.id, job.id);
                const upload = await clients.dh.uploadAttachment(
                    c.id,
                    new Blob(["가상 검토 자료"], { type: "text/plain" }),
                    "가상 상담.txt",
                    randomUUID(),
                );
                await repo
                    .sendVisitorMessage(
                        channels.dh.publicKey,
                        c.token,
                        {
                            clientId: randomUUID(),
                            body: "디자인 구독에 첨부된 자료입니다.",
                            attachmentIds: [upload.id],
                        },
                        db,
                    )
                    .then(() =>
                        assert.fail("직원 업로드를 고객이 사용하면 안 됩니다."),
                    )
                    .catch((e) => assert.ok(e.status));
                await clients.dh.reply(
                    c.id,
                    "사람이 확인할게요.",
                    randomUUID(),
                );
                let detail = await repo.conversationDetail(actor, c.id, db);
                assert.equal(detail.conversation.aiState, "human");
                await clients.dh.updateConversation(c.id, {
                    version: detail.conversation.version,
                    aiState: "auto",
                });
                await message(c, "디자인 구독 요금이 궁금합니다.");
                assert.equal((await latest(c)).mode, "reply");
                // 실제 첨부 바이트는 앞선 파일 QA와 같은 방문자 API로 등록한다.
                const bytes = new FormData();
                bytes.set(
                    "file",
                    new Blob(["고객 가상 자료"], { type: "text/plain" }),
                    "고객 자료.txt",
                );
                bytes.set("clientId", randomUUID());
                bytes.set("kind", "customer");
                const response = await ctx.dispatch(
                    `http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}/attachments`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${c.token}`,
                            Origin: "http://127.0.0.1:3122",
                        },
                        body: bytes,
                    },
                );
                assert.equal(response.status, 200);
                const file = (await response.json()).data;
                const count = callCount;
                await repo.sendVisitorMessage(
                    channels.dh.publicKey,
                    c.token,
                    {
                        clientId: randomUUID(),
                        body: "첨부 자료 확인해주세요.",
                        attachmentIds: [file.id],
                    },
                    db,
                );
                detail = await repo.conversationDetail(actor, c.id, db);
                assert.equal(detail.conversation.aiState, "human");
                assert.equal(callCount, count);
                const manualJob = await manual(c);
                assert.equal(manualJob.state, "handed_off");
                assert.equal(callCount, count);
            },
        );
        await check(
            "지식 확인일 만료·부분 사용량 미확인·SQL 컬럼 대응",
            async () => {
                const { getTableConfig } = require("drizzle-orm/pg-core");
                for (const table of [
                    s.customerAiJobs,
                    s.customerAiCalls,
                    s.customerAiSettings,
                    s.customerAiSettingsHistory,
                    s.customerAiDailyUsage,
                ]) {
                    const config = getTableConfig(table),
                        columns = (
                            await pg.query(
                                "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                                [config.name],
                            )
                        ).rows;
                    assert.deepEqual(
                        columns.map((c) => c.column_name).sort(),
                        config.columns.map((c) => c.name).sort(),
                    );
                }
                await settings({ mode: "manual" });
                const c = await chat(),
                    job = await queueSupportJob(actor, c.id, randomUUID(), db);
                const call = async (...args) => ({
                    ...(await fakeCall(...args)),
                    promptTokens: null,
                    completionTokens: null,
                });
                await processSupportJob(job.id, {
                    exec: db,
                    deps: { ...deps, call },
                });
                const detail = await clients.dh.supportDraft(c.id, job.id);
                assert.ok(
                    detail.calls.every(
                        (c) =>
                            c.promptTokens === null &&
                            c.completionTokens === null,
                    ),
                );
                const [original] = await db
                    .select()
                    .from(s.aiCopyKnowledgeVersions)
                    .where(eq(s.aiCopyKnowledgeVersions.id, knowledge.id));
                await db
                    .update(s.aiCopyKnowledgeVersions)
                    .set({
                        snapshot: {
                            ...original.snapshot,
                            claims: original.snapshot.claims.map((c) => ({
                                ...c,
                                checkedAt: "2000-01-01T00:00:00.000Z",
                            })),
                        },
                    })
                    .where(eq(s.aiCopyKnowledgeVersions.id, knowledge.id));
                assert.equal(
                    (await clients.dh.supportDraft(c.id, job.id)).usable,
                    false,
                );
                await db
                    .update(s.aiCopyKnowledgeVersions)
                    .set({ snapshot: original.snapshot })
                    .where(eq(s.aiCopyKnowledgeVersions.id, knowledge.id));
                await db
                    .update(s.organizationMembers)
                    .set({ role: "member" })
                    .where(
                        and(
                            eq(
                                s.organizationMembers.organizationId,
                                actor.orgId,
                            ),
                            eq(s.organizationMembers.userId, actor.userId),
                        ),
                    );
                await assert.rejects(
                    () => clients.dh.updateSupportAiSettings(8, { version: 0 }),
                    (e) => e.status === 403,
                );
                await db
                    .update(s.organizationMembers)
                    .set({ role: "admin" })
                    .where(
                        and(
                            eq(
                                s.organizationMembers.organizationId,
                                actor.orgId,
                            ),
                            eq(s.organizationMembers.userId, actor.userId),
                        ),
                    );
            },
        );
        await check("지식 차단은 준비된 초안의 사용을 중단", async () => {
            await settings({ mode: "manual" });
            const c = await chat(),
                job = await manual(c);
            await clients.dh.reviewSupportKnowledge(
                8,
                knowledge.id,
                "block",
                "가격 변경으로 다시 검토할 때까지 사용 중단합니다.",
            );
            assert.equal(
                (await clients.dh.supportDraft(c.id, job.id)).usable,
                false,
            );
            await assert.rejects(
                () =>
                    clients.dh.reply(
                        c.id,
                        job.answer,
                        randomUUID(),
                        "reply",
                        [],
                        job.id,
                    ),
                (e) => e.status === 409,
            );
        });
        console.log(
            `고객 상담 AI SQL/API QA: ${checks}개 통과. 실제 모델 호출·외부 발송 0건.`,
        );
        if (extra) await extra(ctx);
        else await pg.close();
    });
}
if (require.main === module)
    runAiCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runAiCheck };
