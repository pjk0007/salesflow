/* eslint-disable @typescript-eslint/no-require-imports -- 격리 PostgreSQL과 가상 Google HTTP만 사용 */
const assert = require("node:assert/strict"),
    Module = require("node:module"),
    { randomUUID, createHash } = require("node:crypto");
async function runGoogleCheck(extra) {
    await require("./check-customer-platform.cjs").runPlatformCheck(
        async (ctx) => {
            const { db, pg, actor, otherActor, repo, dispatch } = ctx,
                s = require("../src/lib/db/schema.ts"),
                { eq, and } = require("drizzle-orm"),
                originalLoad = Module._load;
            Module._load = function (name, parent) {
                const resolved = Module._resolveFilename(
                    name,
                    parent,
                ).replaceAll("\\", "/");
                if (resolved.endsWith("/src/lib/db/index.ts"))
                    return { ...s, db };
                return originalLoad.apply(this, arguments);
            };
            const oauth = require("../src/lib/inbox-email/google-connection.ts"),
                config = require("../src/lib/inbox-email/google-config.ts"),
                email = require("../src/lib/inbox-email/repository.ts"),
                {
                    processGoogleMailQueue,
                } = require("../src/lib/inbox-email/google-worker.ts"),
                {
                    googleTransport,
                } = require("../src/lib/inbox-email/google-transport.ts"),
                {
                    clearGmailTokenCache,
                } = require("../src/lib/gmail-client.ts"),
                { generateToken } = require("../src/lib/auth.ts");
            Module._load = originalLoad;
            const cfg = {
                    clientId: "fake-google-app",
                    clientSecret: "fake-google-secret",
                    redirectUri:
                        "http://127.0.0.1:3120/api/email-google/callback",
                    encryptionKey: "fake-encryption-only",
                },
                startTime = new Date(),
                since = new Date(startTime.getTime() - 86400000),
                bigHistory = "9007199254740993000";
            let time = new Date(startTime),
                checks = 0,
                sends = 0,
                fetches = 0,
                historyExpired = false,
                historyPage = 0,
                brokenId = null,
                wrongAccount = false,
                missingScope = false,
                sourceAuth = false,
                quotaExceeded = false,
                disconnectDuringPoll = false;
            const now = () => new Date(time),
                check = async (name, fn) => {
                    await fn();
                    console.log(`PASS GOOGLE ${++checks} ${name}`);
                };
            const box = await email.createMailbox(
                    actor,
                    {
                        workspaceId: 8,
                        address: "google-dh@example.test",
                        name: "디하 Google QA",
                    },
                    db,
                ),
                bo = await email.createMailbox(
                    actor,
                    {
                        workspaceId: 10,
                        address: "google-bo@example.test",
                        name: "백오랩 Google QA",
                    },
                    db,
                );
            const readConnection = async (id = box.id) =>
                (
                    await db
                        .select()
                        .from(s.inboxGoogleConnections)
                        .where(eq(s.inboxGoogleConnections.mailboxId, id))
                )[0];
            const readBox = async (id = box.id) =>
                (
                    await db
                        .select()
                        .from(s.inboxMailboxes)
                        .where(eq(s.inboxMailboxes.id, id))
                )[0];
            const sourceRows = async () =>
                (await db.select().from(s.inboxGoogleSyncJobs)).filter(
                    (j) => j.mailboxId === box.id,
                );
            const start = async (id = box.id, days = 7) => {
                const b = await readBox(id);
                const result = await oauth.beginGoogleConnection(
                    actor,
                    id,
                    { version: b.version, lookbackDays: days },
                    "http://127.0.0.1:3120",
                    db,
                    cfg,
                    now(),
                );
                return {
                    ...result,
                    state: new URL(result.authorizationUrl).searchParams.get(
                        "state",
                    ),
                };
            };
            const finish = async (request, id = box.id) =>
                oauth.finishGoogleConnection(
                    actor,
                    {
                        state: request.state,
                        cookie: request.cookie,
                        code: id === bo.id ? "bo-code" : "dh-code",
                    },
                    db,
                    cfg,
                    fake,
                    now(),
                );
            const enable = async (id = box.id) => {
                const b = await readBox(id);
                return email.changeMailbox(
                    actor,
                    id,
                    { version: b.version, enabled: true },
                    db,
                );
            };
            const phase = async (action, id = box.id) => {
                time = new Date(time.getTime() + 2000);
                await db
                    .update(s.inboxGoogleConnections)
                    .set({ action, nextRunAt: now() })
                    .where(eq(s.inboxGoogleConnections.mailboxId, id));
                return processGoogleMailQueue({
                    exec: db,
                    config: cfg,
                    now,
                    fetchImpl: fake,
                    mailboxId: id,
                });
            };
            const sourceMessage = (id) => ({
                id,
                threadId: `thread-${id}`,
                internalDate: String(
                    id === "old_1"
                        ? since.getTime() - 60 * 86400000
                        : time.getTime() - 500,
                ),
                labelIds: id === "spam_1" ? ["SPAM"] : [],
                payload: {
                    mimeType: "text/plain",
                    headers: [
                        {
                            name: "From",
                            value: "가상 문의 <lead@example.test>",
                        },
                        {
                            name: "To",
                            value:
                                id === "cc_1" ||
                                id === "bcc_1" ||
                                id === "other_1"
                                    ? "other@example.test"
                                    : box.address,
                        },
                        ...(id === "cc_1"
                            ? [{ name: "Cc", value: box.address }]
                            : []),
                        ...(id === "bcc_1"
                            ? [{ name: "Delivered-To", value: box.address }]
                            : []),
                        { name: "Message-ID", value: `<${id}@example.test>` },
                        { name: "Subject", value: "가상 Google 자동 수신" },
                        ...(id === "auto_1"
                            ? [
                                  {
                                      name: "Auto-Submitted",
                                      value: "auto-replied",
                                  },
                              ]
                            : []),
                    ],
                    body: {
                        size: Buffer.byteLength("상담을 부탁드립니다."),
                        data: Buffer.from("상담을 부탁드립니다.").toString(
                            "base64url",
                        ),
                    },
                },
            });
            async function fake(input, init = {}) {
                fetches++;
                const url = new URL(String(input));
                if (url.origin === "https://oauth2.googleapis.com") {
                    const body = new URLSearchParams(String(init.body));
                    assert.equal(body.get("client_secret"), cfg.clientSecret);
                    return Response.json({
                        access_token:
                            body.get("code") === "bo-code" ||
                            body.get("refresh_token") === "fake-bo-refresh"
                                ? "bo-access"
                                : "dh-access",
                        refresh_token:
                            body.get("code") === "bo-code"
                                ? "fake-bo-refresh"
                                : "fake-dh-refresh",
                        expires_in: 3600,
                        scope: missingScope
                            ? "https://www.googleapis.com/auth/gmail.readonly"
                            : config.GOOGLE_MAIL_SCOPES.join(" "),
                    });
                }
                assert.equal(url.origin, "https://gmail.googleapis.com");
                if (url.pathname.endsWith("/profile"))
                    return Response.json({
                        emailAddress: wrongAccount
                            ? "wrong@example.test"
                            : String(
                                    init.headers?.authorization ??
                                        init.headers?.Authorization,
                                ).includes("bo-access")
                              ? bo.address
                              : box.address,
                        historyId: bigHistory,
                    });
                if (url.pathname.endsWith("/messages/send")) {
                    sends++;
                    return Response.json({ id: "fake-sent-" + sends });
                }
                if (quotaExceeded && url.pathname.endsWith("/messages"))
                    return Response.json(
                        {
                            error: {
                                errors: [{ reason: "rateLimitExceeded" }],
                            },
                        },
                        { status: 403 },
                    );
                if (url.pathname.endsWith("/messages")) {
                    assert.ok(url.searchParams.get("q").includes("-in:sent"));
                    assert.equal(url.searchParams.has("labelIds"), false);
                    if (disconnectDuringPoll) {
                        disconnectDuringPoll = false;
                        await oauth.disconnectGoogle(
                            actor,
                            box.id,
                            (await readConnection()).version,
                            db,
                        );
                    }
                    return Response.json(
                        url.searchParams.get("pageToken") === "p2"
                            ? {
                                  messages: [
                                      { id: "new_1" },
                                      { id: "bad_1" },
                                      { id: "cc_1" },
                                      { id: "bcc_1" },
                                      { id: "spam_1" },
                                      { id: "old_1" },
                                      { id: "other_1" },
                                      { id: "auto_1" },
                                  ],
                              }
                            : {
                                  messages: [{ id: "new_1" }, { id: "new_2" }],
                                  nextPageToken: "p2",
                              },
                    );
                }
                if (url.pathname.endsWith("/history")) {
                    if (historyExpired) {
                        historyExpired = false;
                        return new Response("expired", { status: 404 });
                    }
                    assert.equal(
                        url.searchParams.get("startHistoryId"),
                        bigHistory,
                    );
                    return Response.json(
                        historyPage++ === 0
                            ? {
                                  historyId: "9007199254740993999",
                                  history: [
                                      {
                                          messagesAdded: [
                                              { message: { id: "new_3" } },
                                              { message: { id: "new_1" } },
                                          ],
                                      },
                                  ],
                                  nextPageToken: "h2",
                              }
                            : {
                                  historyId: "9007199254740993999",
                                  history: [
                                      {
                                          labelsAdded: [
                                              {
                                                  message: { id: "new_4" },
                                                  labelIds: ["INBOX"],
                                              },
                                          ],
                                      },
                                  ],
                              },
                    );
                }
                const match = url.pathname.match(/\/messages\/([^/]+)$/);
                if (match) {
                    if (sourceAuth)
                        return new Response("revoked", { status: 401 });
                    const id = match[1];
                    if (id === brokenId)
                        return new Response("busy", { status: 503 });
                    if (id === "bad_1")
                        return Response.json({
                            ...sourceMessage(id),
                            payload: {
                                mimeType: "text/plain",
                                headers: [],
                                body: {},
                            },
                        });
                    if (id === "file_1") {
                        const message = sourceMessage(id),
                            png = Buffer.from(
                                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yG5kAAAAASUVORK5CYII=",
                                "base64",
                            );
                        message.payload = {
                            mimeType: "multipart/mixed",
                            headers: message.payload.headers,
                            parts: [
                                { ...message.payload, headers: [] },
                                {
                                    filename: "자동 수신 로고.png",
                                    mimeType: "image/png",
                                    partId: "1",
                                    body: {
                                        size: png.length,
                                        data: png.toString("base64url"),
                                    },
                                },
                            ],
                        };
                        return Response.json(message);
                    }
                    return Response.json(sourceMessage(id));
                }
                throw new Error("예상하지 않은 가상 Google 요청");
            }
            const envNames = [
                    "CUSTOMER_EMAIL_GOOGLE_CLIENT_ID",
                    "CUSTOMER_EMAIL_GOOGLE_CLIENT_SECRET",
                    "CUSTOMER_EMAIL_GOOGLE_REDIRECT_URI",
                    "CUSTOMER_EMAIL_ENCRYPTION_KEY",
                ],
                savedEnv = envNames.map((k) => process.env[k]);
            for (const [i, value] of [
                cfg.clientId,
                cfg.clientSecret,
                cfg.redirectUri,
                cfg.encryptionKey,
            ].entries())
                process.env[envNames[i]] = value;
            const realFetch = global.fetch;
            global.fetch = async () => {
                throw new Error("실제 외부 HTTP 금지");
            };
            try {
                let request, connection;
                await check(
                    "OAuth 브라우저 nonce·PKCE·다른 조직·다른 Origin·재사용 거부",
                    async () => {
                        request = await start();
                        const url = new URL(request.authorizationUrl);
                        assert.equal(url.origin, "https://accounts.google.com");
                        assert.equal(
                            url.searchParams.get("code_challenge_method"),
                            "S256",
                        );
                        const state = (
                                await db.select().from(s.inboxGoogleOauthStates)
                            )[0],
                            verifier = config.openGoogleValue(
                                state.verifierCipher,
                                `oauth:${state.stateHash}`,
                                cfg,
                            );
                        assert.equal(
                            url.searchParams.get("code_challenge"),
                            createHash("sha256")
                                .update(verifier)
                                .digest("base64url"),
                        );
                        await assert.rejects(
                            oauth.finishGoogleConnection(
                                otherActor,
                                {
                                    state: request.state,
                                    cookie: request.cookie,
                                    code: "fake",
                                },
                                db,
                                cfg,
                                fake,
                                now(),
                            ),
                        );
                        await assert.rejects(
                            oauth.finishGoogleConnection(
                                actor,
                                {
                                    state: request.state,
                                    cookie: "wrong",
                                    code: "fake",
                                },
                                db,
                                cfg,
                                fake,
                                now(),
                            ),
                        );
                        await assert.rejects(
                            oauth.beginGoogleConnection(
                                actor,
                                box.id,
                                { version: box.version, lookbackDays: 7 },
                                "https://other.example.test",
                                db,
                                cfg,
                                now(),
                            ),
                        );
                        assert.equal(
                            (await finish(request)).result,
                            "connected",
                        );
                        await assert.rejects(finish(request));
                        connection = await readConnection();
                        assert.equal((await readBox()).enabled, false);
                        assert.equal(connection.historyId, null);
                        assert.equal(connection.baselineHistoryId, bigHistory);
                        assert.notEqual(
                            connection.refreshCipher,
                            "fake-dh-refresh",
                        );
                        assert.equal(
                            config.openGoogleValue(
                                connection.refreshCipher,
                                `mailbox:${box.id}:${connection.version}`,
                                cfg,
                            ),
                            "fake-dh-refresh",
                        );
                        await assert.rejects(async () =>
                            config.openGoogleValue(
                                connection.refreshCipher,
                                `mailbox:${bo.id}:${connection.version}`,
                                cfg,
                            ),
                        );
                    },
                );
                await check(
                    "계정 불일치·권한 누락·설정 변경·만료 승인에서 기존 연결 보존",
                    async () => {
                        const original = connection.version;
                        wrongAccount = true;
                        await assert.rejects(finish(await start()));
                        wrongAccount = false;
                        missingScope = true;
                        await assert.rejects(finish(await start()));
                        missingScope = false;
                        request = await start();
                        await enable();
                        await assert.rejects(finish(request));
                        assert.equal(
                            (await readConnection()).version,
                            original,
                        );
                        request = await start();
                        await assert.rejects(
                            oauth.finishGoogleConnection(
                                actor,
                                {
                                    state: request.state,
                                    cookie: request.cookie,
                                    code: "fake",
                                },
                                db,
                                cfg,
                                fake,
                                new Date(time.getTime() + 601000),
                            ),
                        );
                    },
                );
                await check(
                    "실제 관리 API 인증·Origin·HttpOnly cookie·비밀 제외 응답",
                    async () => {
                        const endpoint = `http://127.0.0.1:3120/api/email-mailboxes/${box.id}/google`,
                            headers = {
                                authorization: `Bearer ${generateToken(actor)}`,
                                "content-type": "application/json",
                                origin: "http://127.0.0.1:3120",
                            };
                        assert.equal((await dispatch(endpoint)).status, 401);
                        assert.equal(
                            (
                                await dispatch(endpoint, {
                                    method: "POST",
                                    headers: {
                                        ...headers,
                                        origin: "https://other.example.test",
                                    },
                                    body: JSON.stringify({ action: "retry" }),
                                })
                            ).status,
                            403,
                        );
                        const response = await dispatch(endpoint, {
                            method: "POST",
                            headers,
                            body: JSON.stringify({
                                action: "connect",
                                version: (await readBox()).version,
                                lookbackDays: 30,
                            }),
                        });
                        assert.equal(
                            response.status,
                            200,
                            response.status === 200
                                ? undefined
                                : JSON.stringify(await response.json()),
                        );
                        assert.match(
                            response.headers.get("set-cookie"),
                            /HttpOnly/,
                        );
                        assert.match(
                            response.headers.get("set-cookie"),
                            /SameSite=lax/,
                        );
                        const started = await response.json(),
                            authState = new URL(
                                started.data.authorizationUrl,
                            ).searchParams.get("state"),
                            nonceCookie = response.headers
                                .get("set-cookie")
                                .split(";")[0];
                        global.fetch = fake;
                        const approved = await dispatch(
                            `http://127.0.0.1:3120/api/email-google/callback?state=${encodeURIComponent(authState)}&code=dh-code`,
                            { headers: { ...headers, cookie: nonceCookie } },
                        );
                        global.fetch = async () => {
                            throw new Error("실제 외부 HTTP 금지");
                        };
                        assert.equal(approved.status, 303);
                        assert.match(
                            approved.headers.get("location"),
                            /emailConnection=connected/,
                        );
                        assert.ok(
                            !approved.headers
                                .get("location")
                                .includes("dh-code"),
                        );
                        assert.equal((await readBox()).enabled, false);
                        await enable();
                        const dto = JSON.stringify(
                            await (
                                await dispatch(endpoint, { headers })
                            ).json(),
                        );
                        for (const secret of [
                            cfg.clientSecret,
                            cfg.encryptionKey,
                            "fake-dh-refresh",
                            "refreshCipher",
                            "verifierCipher",
                        ])
                            assert.ok(!dto.includes(secret));
                        const callback = await dispatch(
                            "http://127.0.0.1:3120/api/email-google/callback?state=bad&code=not-leaked",
                            { headers },
                        );
                        assert.equal(callback.status, 303);
                        assert.ok(
                            !callback.headers
                                .get("location")
                                .includes("not-leaked"),
                        );
                    },
                );
                await check(
                    "페이지 커서와 원본 대기열 원자성·중복 번호·아카이브 메일 포함",
                    async () => {
                        await pg.exec(
                            "CREATE FUNCTION fail_google_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.page_token='p2' THEN RAISE EXCEPTION 'qa cursor rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_google_cursor BEFORE UPDATE ON inbox_google_connections FOR EACH ROW EXECUTE FUNCTION fail_google_cursor();",
                        );
                        assert.equal((await phase("poll")).failed, true);
                        assert.equal((await sourceRows()).length, 0);
                        assert.equal((await readConnection()).pageToken, null);
                        await pg.exec(
                            "DROP TRIGGER fail_google_cursor ON inbox_google_connections; DROP FUNCTION fail_google_cursor();",
                        );
                        assert.equal((await phase("poll")).failed, false);
                        assert.equal((await readConnection()).pageToken, "p2");
                        assert.equal((await sourceRows()).length, 2);
                        await phase("poll");
                        connection = await readConnection();
                        assert.equal(connection.phase, "history");
                        assert.equal(connection.historyId, bigHistory);
                        assert.equal((await sourceRows()).length, 9);
                    },
                );
                await check(
                    "수신·CC/BCC·자동 응답·원본 오류 분리, 다른 문의 수신 계속",
                    async () => {
                        for (let i = 0; i < 11; i++) await phase("receive");
                        const rows = await sourceRows();
                        assert.equal(
                            rows.find((j) => j.providerMessageId === "bad_1")
                                .state,
                            "failed",
                        );
                        for (const id of [
                            "new_1",
                            "new_2",
                            "cc_1",
                            "bcc_1",
                            "auto_1",
                        ])
                            assert.equal(
                                rows.find((j) => j.providerMessageId === id)
                                    .state,
                                "done",
                            );
                        for (const id of ["spam_1", "old_1", "other_1"])
                            assert.equal(
                                rows.find((j) => j.providerMessageId === id)
                                    .state,
                                "skipped",
                                id,
                            );
                        const auto = (
                            await db.select().from(s.inboxEmailReceipts)
                        ).find((r) => r.providerMessageId === "auto_1");
                        assert.equal(auto.ignoredReason, "automatic_message");
                        assert.equal(auto.messageId, null);
                        const status = await oauth.googleConnectionStatus(
                            actor,
                            box.id,
                            db,
                        );
                        assert.equal(status.counts.failed, 1);
                        assert.equal(status.counts.pending, 0);
                        assert.equal(status.workerEnabled, false);
                        assert.equal(
                            (await oauth.retryGoogleJobs(actor, box.id, db))
                                .retried,
                            1,
                        );
                    },
                );
                await check(
                    "Delivered-To 추가 전 기록도 중복 수신 가능·다른 본문은 충돌",
                    async () => {
                        const old = (
                                await db.select().from(s.inboxEmailReceipts)
                            ).find((r) => r.providerMessageId === "new_1"),
                            input = {
                                ...old.envelope,
                                deliveredTo: [box.address],
                            };
                        assert.equal(
                            (await email.receiveEmail(actor, box.id, input, db))
                                .duplicate,
                            true,
                        );
                        await assert.rejects(
                            email.receiveEmail(
                                actor,
                                box.id,
                                { ...input, body: "바뀐 원본" },
                                db,
                            ),
                        );
                    },
                );
                await check(
                    "증분 이력 두 페이지·큰 ID 문자열·중복 없는 대기열",
                    async () => {
                        await phase("poll");
                        assert.equal((await readConnection()).pageToken, "h2");
                        assert.equal(
                            (await readConnection()).historyId,
                            bigHistory,
                        );
                        await phase("poll");
                        assert.equal(
                            (await readConnection()).historyId,
                            "9007199254740993999",
                        );
                        assert.equal((await sourceRows()).length, 11);
                    },
                );
                await check(
                    "만료된 history404 복구는 최초 수신 범위를 보존",
                    async () => {
                        const originalSince = (await readConnection()).since;
                        historyExpired = true;
                        await phase("poll");
                        connection = await readConnection();
                        assert.equal(connection.phase, "full");
                        assert.equal(
                            connection.since.toISOString(),
                            originalSince.toISOString(),
                        );
                        assert.equal(connection.baselineHistoryId, bigHistory);
                    },
                );
                await check(
                    "중단된 수신 lease 복구·일시 실패 백오프·다음 원본 계속",
                    async () => {
                        await db
                            .update(s.inboxGoogleSyncJobs)
                            .set({
                                state: "processing",
                                leaseToken: randomUUID(),
                                leaseUntil: new Date(time.getTime() - 1),
                                attempts: 1,
                                eligibleAt: now(),
                            })
                            .where(
                                and(
                                    eq(s.inboxGoogleSyncJobs.mailboxId, box.id),
                                    eq(
                                        s.inboxGoogleSyncJobs.providerMessageId,
                                        "new_3",
                                    ),
                                ),
                            );
                        // Leave only this source eligible for deterministic recovery.
                        await db
                            .update(s.inboxGoogleSyncJobs)
                            .set({
                                eligibleAt: new Date(time.getTime() + 1000000),
                            })
                            .where(
                                and(
                                    eq(s.inboxGoogleSyncJobs.mailboxId, box.id),
                                    eq(s.inboxGoogleSyncJobs.state, "pending"),
                                ),
                            );
                        brokenId = "new_3";
                        await phase("receive");
                        let row = (await sourceRows()).find(
                            (j) => j.providerMessageId === "new_3",
                        );
                        assert.equal(row.state, "pending");
                        assert.equal(row.attempts, 2);
                        assert.ok(row.eligibleAt > time);
                        brokenId = null;
                        time = new Date(row.eligibleAt);
                        await phase("receive");
                        row = (await sourceRows()).find(
                            (j) => j.providerMessageId === "new_3",
                        );
                        assert.equal(row.state, "done");
                        assert.equal(row.attempts, 3);
                    },
                );
                let conversationId;
                await check(
                    "상담 답장 순서·준비중 중복 claim 방지·자동 발송 ACK",
                    async () => {
                        const receipt = (
                                await db.select().from(s.inboxEmailReceipts)
                            ).find((r) => r.providerMessageId === "new_1"),
                            msg = (
                                await db
                                    .select()
                                    .from(s.inboxMessages)
                                    .where(
                                        eq(
                                            s.inboxMessages.id,
                                            receipt.messageId,
                                        ),
                                    )
                            )[0];
                        conversationId = msg.conversationId;
                        await repo.sendAgentMessage(
                            actor,
                            conversationId,
                            {
                                clientId: randomUUID(),
                                body: "첫 번째 가상 답장",
                                kind: "reply",
                            },
                            db,
                        );
                        await repo.sendAgentMessage(
                            actor,
                            conversationId,
                            {
                                clientId: randomUUID(),
                                body: "두 번째 가상 답장",
                                kind: "reply",
                            },
                            db,
                        );
                        const first = await email.claimEmail(
                            actor,
                            box.id,
                            db,
                            now(),
                        );
                        assert.ok(first);
                        assert.equal(
                            await email.claimEmail(actor, box.id, db, now()),
                            null,
                        );
                        await email.changeEmailDelivery(
                            actor,
                            first.id,
                            { action: "begin", leaseToken: first.leaseToken },
                            db,
                            now(),
                        );
                        assert.equal(
                            await email.claimEmail(actor, box.id, db, now()),
                            null,
                        );
                        await email.changeEmailDelivery(
                            actor,
                            first.id,
                            {
                                action: "sent",
                                leaseToken: first.leaseToken,
                                providerMessageId: "first-qa",
                            },
                            db,
                            now(),
                        );
                        await phase("send");
                        assert.equal(sends, 1);
                        assert.equal(
                            (
                                await db
                                    .select()
                                    .from(s.inboxEmailDeliveries)
                                    .where(
                                        eq(
                                            s.inboxEmailDeliveries.mailboxId,
                                            box.id,
                                        ),
                                    )
                            ).filter((d) => d.state === "sent").length,
                            2,
                        );
                    },
                );
                await check(
                    "자동 수신 원본→첨부 대기열→보호 파일 실제 바이트",
                    async () => {
                        await db.insert(s.inboxGoogleSyncJobs).values({
                            mailboxId: box.id,
                            connectionVersion: (await readConnection()).version,
                            providerMessageId: "file_1",
                            eligibleAt: now(),
                        });
                        await phase("receive");
                        const job = (await sourceRows()).find(
                            (j) => j.providerMessageId === "file_1",
                        );
                        assert.equal(job.state, "done");
                        const transport = googleTransport(
                            actor,
                            (await readConnection()).version,
                            db,
                            now,
                        );
                        let files = await transport.emailReceiptFiles(
                            job.receiptId,
                        );
                        assert.equal(files[0].state, "pending");
                        await phase("files");
                        files = await transport.emailReceiptFiles(
                            job.receiptId,
                        );
                        assert.equal(files[0].state, "available");
                        const blob = (
                            await db
                                .select()
                                .from(s.inboxAttachmentBlobs)
                                .where(
                                    eq(
                                        s.inboxAttachmentBlobs.attachmentId,
                                        files[0].attachmentId,
                                    ),
                                )
                        )[0];
                        assert.equal(blob.bytes.length, 68);
                    },
                );
                await check(
                    "두 사업 독립 OAuth·원본·고객 및 직원 조직 격리",
                    async () => {
                        request = await start(bo.id);
                        assert.equal(
                            (await finish(request, bo.id)).result,
                            "connected",
                        );
                        await enable(bo.id);
                        assert.equal(
                            (await readConnection(bo.id)).status,
                            "connected",
                        );
                        await assert.rejects(
                            oauth.googleConnectionStatus(
                                otherActor,
                                box.id,
                                db,
                            ),
                        );
                        const boStatus = await oauth.googleConnectionStatus(
                            actor,
                            bo.id,
                            db,
                        );
                        assert.equal(boStatus.counts.done, 0);
                    },
                );
                await check(
                    "서버 재시작·중복 워커는 살아있는 lease를 건드리지 않고 만료 후 복구",
                    async () => {
                        const count = fetches;
                        await db
                            .update(s.inboxGoogleConnections)
                            .set({
                                leaseToken: randomUUID(),
                                leaseUntil: new Date(time.getTime() + 120000),
                                nextRunAt: now(),
                            })
                            .where(
                                eq(s.inboxGoogleConnections.mailboxId, bo.id),
                            );
                        assert.equal(
                            (
                                await processGoogleMailQueue({
                                    exec: db,
                                    config: cfg,
                                    now,
                                    fetchImpl: fake,
                                    mailboxId: bo.id,
                                })
                            ).processed,
                            0,
                        );
                        assert.equal(fetches, count);
                        await db
                            .update(s.inboxGoogleConnections)
                            .set({ leaseUntil: new Date(time.getTime() - 1) })
                            .where(
                                eq(s.inboxGoogleConnections.mailboxId, bo.id),
                            );
                        assert.equal((await phase("poll", bo.id)).processed, 1);
                    },
                );
                await check(
                    "처리 중 연결 해제는 커서·대기열 변경 차단, 예전 작업 세대 차단",
                    async () => {
                        const oldVersion = (await readConnection()).version,
                            transport = googleTransport(
                                actor,
                                oldVersion,
                                db,
                                now,
                            ),
                            count = (await sourceRows()).length;
                        disconnectDuringPoll = true;
                        await phase("poll");
                        assert.equal(
                            (await readConnection()).status,
                            "disconnected",
                        );
                        assert.equal((await readBox()).enabled, false);
                        assert.equal((await sourceRows()).length, count);
                        await assert.rejects(transport.claimEmail(box.id));
                        request = await start();
                        await finish(request);
                        await enable();
                        await assert.rejects(transport.claimEmail(box.id));
                        const resumed = await sourceRows();
                        assert.equal(
                            resumed.find((j) => j.providerMessageId === "old_1")
                                .state,
                            "pending",
                        );
                        assert.equal(
                            resumed.find((j) => j.providerMessageId === "new_1")
                                .state,
                            "done",
                        );
                        assert.equal(
                            (await readConnection(bo.id)).status,
                            "connected",
                        );
                    },
                );
                await check(
                    "발송 준비 제한시간 뒤에는 provider POST 없이 lease 복구",
                    async () => {
                        await repo.sendAgentMessage(
                            actor,
                            conversationId,
                            {
                                clientId: randomUUID(),
                                body: "준비 시간 복구 가상 답장",
                                kind: "reply",
                            },
                            db,
                        );
                        const transport = googleTransport(
                                actor,
                                (await readConnection()).version,
                                db,
                                now,
                            ),
                            deliver =
                                require("../src/lib/inbox-email/gmail.ts").deliverGmailReply;
                        await assert.rejects(
                            deliver(
                                transport,
                                box.id,
                                {
                                    clientId: cfg.clientId,
                                    clientSecret: cfg.clientSecret,
                                    refreshToken: "fake-dh-refresh",
                                },
                                fake,
                                () => {
                                    throw new Error("qa_preparation_deadline");
                                },
                            ),
                        );
                        assert.equal(sends, 1);
                        const pending = (
                            await db
                                .select()
                                .from(s.inboxEmailDeliveries)
                                .where(
                                    eq(
                                        s.inboxEmailDeliveries.mailboxId,
                                        box.id,
                                    ),
                                )
                        ).find((d) => d.state === "leased");
                        assert.equal(pending.attempts, 0);
                        time = new Date(pending.leaseUntil.getTime() + 1);
                        await phase("send");
                        assert.equal(sends, 2);
                    },
                );
                await check(
                    "Gmail 403 사용량 초과는 계정 해제 대신 자동 백오프",
                    async () => {
                        quotaExceeded = true;
                        await phase("poll");
                        quotaExceeded = false;
                        const c = await readConnection();
                        assert.equal(c.status, "connected");
                        assert.equal(c.errorCode, "rate_limited");
                        assert.ok(c.nextRunAt > now());
                        assert.equal((await readBox()).enabled, true);
                    },
                );
                await check(
                    "회수된 Gmail 권한은 재연결 필요·발송 중지, 자동 재전송 없음",
                    async () => {
                        await db
                            .update(s.inboxGoogleSyncJobs)
                            .set({
                                state: "pending",
                                eligibleAt: now(),
                                attempts: 0,
                            })
                            .where(
                                and(
                                    eq(s.inboxGoogleSyncJobs.mailboxId, box.id),
                                    eq(
                                        s.inboxGoogleSyncJobs.providerMessageId,
                                        "new_4",
                                    ),
                                ),
                            );
                        sourceAuth = true;
                        clearGmailTokenCache();
                        await phase("receive");
                        sourceAuth = false;
                        assert.equal(
                            (await readConnection()).status,
                            "reconnect",
                        );
                        assert.equal((await readBox()).enabled, false);
                        assert.equal(sends, 2);
                        assert.equal(
                            (
                                await processGoogleMailQueue({
                                    exec: db,
                                    config: cfg,
                                    now,
                                    fetchImpl: fake,
                                    mailboxId: box.id,
                                })
                            ).processed,
                            0,
                        );
                    },
                );
                await check(
                    "관리자 권한 회수와 OAuth 앱 변경에서 자동 처리 중단",
                    async () => {
                        await db
                            .update(s.inboxGoogleConnections)
                            .set({ clientId: "different-app" })
                            .where(
                                eq(s.inboxGoogleConnections.mailboxId, bo.id),
                            );
                        await phase("poll", bo.id);
                        assert.equal(
                            (await readConnection(bo.id)).errorCode,
                            "config",
                        );
                        assert.equal((await readBox(bo.id)).enabled, false);
                        request = await start();
                        await finish(request);
                        await enable();
                        await db
                            .update(s.users)
                            .set({ isActive: 0 })
                            .where(eq(s.users.id, actor.userId));
                        await phase("poll");
                        assert.equal(
                            (await readConnection()).status,
                            "reconnect",
                        );
                        await db
                            .update(s.users)
                            .set({ isActive: 1 })
                            .where(eq(s.users.id, actor.userId));
                    },
                );
                await check(
                    "암호화 설정이 바뀌면 계정 재연결 안내·수신 발송 중지",
                    async () => {
                        request = await start();
                        await finish(request);
                        await enable();
                        await db
                            .update(s.inboxGoogleConnections)
                            .set({ nextRunAt: now(), action: "poll" })
                            .where(
                                eq(s.inboxGoogleConnections.mailboxId, box.id),
                            );
                        await processGoogleMailQueue({
                            exec: db,
                            config: { ...cfg, encryptionKey: "different-key" },
                            now,
                            fetchImpl: fake,
                            mailboxId: box.id,
                        });
                        assert.equal(
                            (await readConnection()).status,
                            "reconnect",
                        );
                        assert.equal(
                            (await readConnection()).errorCode,
                            "config",
                        );
                        assert.equal((await readBox()).enabled, false);
                    },
                );
                console.log(
                    `Google 연결·자동 수신 QA ${checks}개 통과 · 가상 HTTP ${fetches}건 · 실제 외부 전송/운영 DB 0건`,
                );
                if (extra)
                    await extra({
                        ...ctx,
                        googleBoxes: { dh: box, bo },
                        googleConfig: cfg,
                        checks,
                    });
                else await pg.close();
            } finally {
                global.fetch = realFetch;
                clearGmailTokenCache();
                for (const [i, k] of envNames.entries()) {
                    if (savedEnv[i] === undefined) delete process.env[k];
                    else process.env[k] = savedEnv[i];
                }
            }
        },
    );
}
if (require.main === module)
    runGoogleCheck().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { runGoogleCheck };
