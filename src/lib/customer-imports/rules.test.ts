import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeImport } from "./adapters";
import {
    createImportInput,
    date,
    fingerprint,
    pathValue,
    sourceUuid,
    importStepInput,
} from "./rules";
test("이전 API 묶음은 기본 25행이며 명시된 1~250행만 허용한다", () => {
    assert.deepEqual(importStepInput.parse({cursor:0}), {cursor:0,batchSize:25});
    assert.deepEqual(importStepInput.parse({cursor:25,batchSize:250}), {cursor:25,batchSize:250});
    for (const batchSize of [0,251,-1,1.5,"250",null]) {
        assert.equal(importStepInput.safeParse({cursor:0,batchSize}).success,false);
    }
    assert.equal(importStepInput.safeParse({cursor:-1,batchSize:250}).success,false);
    assert.equal(importStepInput.safeParse({cursor:0,batchSize:250,skipChecks:true}).success,false);
});
const input = (
    source: "channel" | "intercom" | "hubspot" | "portable",
    content: unknown,
    part = {},
) =>
    createImportInput.parse({
        workspaceId: 8,
        source,
        namespace: "test",
        content: JSON.stringify(content),
        ...part,
    });
test("채널톡 원본 ID·회원 외부 ID·private 메모·밀리초·첨부 정보 보존", () => {
    const result = normalizeImport(
        input("channel", {
            users: [
                {
                    id: "u",
                    member: true,
                    memberId: "member-1",
                    profile: { name: "가상 고객", email: "qa@example.test" },
                },
            ],
            userChats: [
                { id: "v", userId: "u", name: "도입 문의", state: "opened" },
            ],
            messages: [
                {
                    id: "m",
                    chatId: "v",
                    personType: "manager",
                    options: ["private"],
                    plainText: "직원 메모",
                    createdAt: 1715000000000,
                    files: [{ name: "자료.pdf" }],
                },
            ],
        }),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].data.externalId, "member-1");
    assert.equal(result.rows[2].data.messageKind, "note");
    assert.equal(result.rows[2].sourceId, "v/m");
    assert.equal(result.rows[2].data.createdAt, "2024-05-06T12:53:20.000Z");
});
test("채널톡 최신 제목·여섯 상태·RFC3339를 보존하고 확장 상태 변환을 알림", () => {
    const states = ["opened", "closed", "snoozed", "queued", "initial", "missed"],
        chats = states.map((state) => ({
            id: state,
            userId: "u",
            title: `원본 제목 ${state}`,
            name: "이전 제목 필드",
            state,
            createdAt: "2026-10-14T11:20:30+09:00",
        })),
        result = normalizeImport(input("channel", {
            users: [{ id: "u", profile: { name: "가상 고객" } }],
            userChats: chats,
        }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows.filter((r) => r.kind === "conversations").map((r) => r.data.status),
        ["open", "closed", "snoozed", "open", "open", "open"]);
    for (const original of chats) {
        const row = result.rows.find((r) => r.sourceId === original.id)!;
        assert.equal(row.data.name, original.title);
        assert.equal(row.data.createdAt, "2026-10-14T02:20:30.000Z");
        assert.deepEqual(row.original, original);
    }
    assert.equal(result.warnings.length, 3);
    for (const state of ["queued", "initial", "missed"])
        assert.ok(result.warnings.some((w) => w.includes(state) && w.includes("재개하지")));
});
test("채널톡 알 수 없는 상태는 부분 이전 선택으로 조용히 완료 처리하지 않음", () => {
    for (const allowPartialHistory of [false, true]) {
        const result = normalizeImport(input("channel", {
            userChats: [{ id: "v", title: "가상 상담", state: "new-state" }],
        }, { allowPartialHistory }));
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /지원하지 않는 원본 상태 new-state/);
    }
});
test("채널톡 익명 veilId·미확인·상충 신원은 외부 회원 ID로 간주하지 않음", () => {
    const users = [
        { id: "member", type: "member", member: true, memberId: "member-1" },
        { id: "legacy-member", member: true, memberId: "member-2" },
        { id: "visitor", type: "lead", member: false, memberId: "veil-1", veilId: "veil-1" },
        { id: "unknown", memberId: "unconfirmed-1" },
        { id: "contradiction", type: "member", member: false, memberId: "unconfirmed-2" },
        { id: "lead", type: "lead", member: true, memberId: "unconfirmed-3" },
        { id: "unified", type: "unified", memberId: "unconfirmed-4" },
        { id: "veil-member", type: "member", memberId: "veil-2", veilId: "veil-2" },
    ], result = normalizeImport(input("channel", { users }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows.map((r) => r.data.externalId),
        ["member-1", "member-2", undefined, undefined, undefined, undefined, undefined, undefined]);
    assert.equal(result.warnings.length, 6);
    assert.deepEqual(result.rows.map((r) => r.original), users);
});
test("채널톡 작성자 종류별 ID를 분리하고 봇 이름·내부 메모를 보존", () => {
    const messages = [
        { id: "user", personType: "user" },
        { id: "manager", personType: "manager" },
        { id: "bot", personType: "bot" },
        { id: "private-bot", personType: "bot", options: ["private"] },
    ].map((m) => ({
        ...m, chatId: "v", personId: "same-id", plainText: "가상 내용",
        createdAt: "2026-10-14T02:20:30Z",
    }));
    const result = normalizeImport(input("channel", {
        users: [{ id: "same-id", name: "가상 고객" }],
        managers: [{ id: "same-id", name: "가상 상담원" }],
        bots: [{ id: "same-id", name: "가상 안내 봇" }],
        messages,
    }));
    assert.deepEqual(result.errors, []);
    const rows = result.rows.filter((r) => r.kind === "messages");
    const byId = new Map(rows.map((r) => [r.sourceId, r]));
    assert.equal(byId.get("v/user")!.data.authorName, "가상 고객");
    assert.equal(byId.get("v/manager")!.data.authorName, "가상 상담원");
    assert.equal(byId.get("v/bot")!.data.authorName, "가상 안내 봇");
    assert.equal(byId.get("v/private-bot")!.data.authorName, "가상 안내 봇");
    assert.equal(byId.get("v/private-bot")!.data.messageKind, "note");
    for (const original of messages)
        assert.deepEqual(byId.get(`v/${original.id}`)!.original, original);
});
test("404/410 고객 원본은 비활성으로 보관하며 과거 회원 ID로 다른 고객과 합치지 않음", () => {
    const user = { id: "missing-customer", type: "member", member: true, memberId: "historical-id", profile: { name: "원본 고객 정보 조회 불가", email: "historical@example.test" }, sourceProfileUnavailable: { status: 404, sourceId: "missing-customer" } };
    const result = normalizeImport(input("channel", { users: [user] }));
    assert.equal(result.rows[0].data.lifecycleStage, "inactive");
    assert.equal(result.rows[0].data.externalId, undefined);
    assert.equal(result.rows[0].data.email, "historical@example.test");
    assert.deepEqual(result.rows[0].data.attributes, { ...user.profile, sourceProfileUnavailable: user.sourceProfileUnavailable });
    assert.deepEqual(result.rows[0].original, user);
    assert.ok(result.warnings.some(warning => warning.includes("원본 고객 정보 조회 불가")));
    for (const sourceProfileUnavailable of [{ status: 403, sourceId: user.id }, { status: 404, sourceId: "other-customer" }]) {
        const ordinary = normalizeImport(input("channel", { users: [{ ...user, sourceProfileUnavailable }] }));
        assert.equal(ordinary.rows[0].data.lifecycleStage, "lead");
        assert.equal(ordinary.rows[0].data.externalId, "historical-id");
    }
});
test("채널톡 텍스트 없는 rich block은 원본 보존과 표시 한계를 안내", () => {
    const original = {
        id: "m", chatId: "v", personType: "bot", personId: "b",
        blocks: [{ type: "text", value: "가상 원본 블록" }],
        createdAt: "2026-10-14T02:20:30Z",
    };
    const result = normalizeImport(input("channel", {
        bots: [{ id: "b", name: "가상 안내 봇" }], messages: [original],
    }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows[0].original, original);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /원본 레이아웃을 재현하지/);
});
test("채널톡 작성자 상세가 누락되면 이름 대체와 원본 ID 보존을 알림", () => {
    const original = {
        id: "m", chatId: "v", personType: "bot", personId: "unavailable-bot",
        plainText: "가상 안내", createdAt: "2026-10-14T02:20:30Z",
    };
    const result = normalizeImport(input("channel", { messages: [original] }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].data.authorName, "bot");
    assert.deepEqual(result.rows[0].original, original);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /작성자 이름이 없어 bot/);
});
test("인터컴 원본과 부분을 합쳐 note를 구분하고 초 단위 날짜를 유지", () => {
    const result = normalizeImport(
        input("intercom", {
            contacts: [{ id: "u", external_id: "member-1", name: "고객" }],
            conversations: [
                {
                    id: "v",
                    created_at: 1715000000,
                    contacts: { contacts: [{ id: "u" }] },
                    source: {
                        id: "first",
                        body: "문의",
                        author: { type: "user", name: "고객" },
                    },
                    conversation_parts: {
                        conversation_parts: [
                            {
                                id: "note",
                                part_type: "note",
                                body: "메모",
                                author: { type: "admin" },
                                created_at: 1715000001,
                            },
                        ],
                    },
                },
            ],
        }),
    );
    assert.equal(result.rows.filter((r) => r.kind === "messages").length, 2);
    assert.equal(result.rows.at(-1)!.data.messageKind, "note");
    assert.equal(
        result.rows.find((r) => r.sourceId === "v/first")!.data.messageKind,
        "customer",
    );
    assert.equal(date("1715000000"), "2024-05-06T12:53:20.000Z");
});
test("인터컴 500개 제한과 API 다음 페이지는 완료 자료로 조용히 취급하지 않음", () => {
    const source = {
        conversations: [
            {
                id: "v",
                created_at: 1715000000,
                conversation_parts: {
                    conversation_parts: Array.from({ length: 500 }, (_, i) => ({
                        id: String(i),
                        body: "답변",
                        part_type: "comment",
                        created_at: 1715000000,
                        author: { type: "admin" },
                    })),
                },
            },
        ],
    };
    assert.ok(
        normalizeImport(input("intercom", source)).errors.some((e) =>
            e.includes("500"),
        ),
    );
    assert.ok(
        normalizeImport(
            input("intercom", source, { allowPartialHistory: true }),
        ).warnings.some((e) => e.includes("부분")),
    );
    assert.ok(
        normalizeImport(
            input("channel", {
                users: [{ id: "u", profile: { name: "고객" } }],
                next: "cursor",
            }),
        ).errors.length,
    );
});
for (const [label, pagination] of [
    ["v5 next", { next: "cursor" }],
    ["nextCursor와 hasNext", { nextCursor: "cursor", hasNext: true }],
    ["nextCursor만", { nextCursor: "cursor" }],
    ["hasNext만", { nextCursor: null, hasNext: true }],
] as const) {
    test(`채널톡 ${label} 미완료 페이지는 부분 이전 승인으로 우회할 수 없음`, () => {
        for (const allowPartialHistory of [false, true]) {
            const result = normalizeImport(
                input(
                    "channel",
                    {
                        users: [{ id: "u", profile: { name: "가상 고객" } }],
                        ...pagination,
                    },
                    { allowPartialHistory },
                ),
            );
            assert.deepEqual(result.errors, [
                "채널톡 다음 페이지가 남아 있습니다. 모든 페이지를 모아 다시 입력해주세요.",
            ]);
            assert.deepEqual(result.warnings, []);
        }
    });
}
test("채널톡 마지막 페이지와 페이지 표시 없는 완성 묶음은 허용", () => {
    const user = { id: "u", profile: { name: "가상 고객" } };
    for (const pagination of [{ nextCursor: null, hasNext: false }, {}]) {
        const result = normalizeImport(
            input("channel", { users: [user], ...pagination }),
        );
        assert.deepEqual(result.errors, []);
        assert.equal(result.rows.length, 1);
        assert.deepEqual(result.rows[0].original, user);
    }
});
test("허브스팟 properties·관계 원본 ID·파이프라인 단계를 보존", () => {
    const company = {
        id: "co",
        properties: { name: "회사", domain: "example.test" },
    };
    const contact = {
        id: "c",
        properties: { firstname: "가상", lastname: "고객" },
        associations: { companies: { results: [{ id: "co" }] } },
    };
    const deal = {
        id: "d",
        properties: {
            dealname: "계약",
            pipeline: "p",
            dealstage: "won",
            amount: "1000",
            deal_currency_code: "KRW",
        },
        associations: {
            contacts: { results: [{ id: "c" }] },
            companies: { results: [{ id: "co" }] },
        },
    };
    const pipeline = {
        id: "p",
        label: "영업",
        stages: [
            {
                id: "won",
                label: "계약",
                metadata: { isClosed: "true", probability: "1.0" },
            },
        ],
    };
    const result = normalizeImport(
        input("hubspot", {
            companies: { results: [company] },
            contacts: { results: [contact] },
            pipelines: { results: [pipeline] },
            deals: { results: [deal] },
        }),
    );
    assert.deepEqual(
        result.rows.find((r) => r.kind === "contacts")!.data.companyIds,
        ["co"],
    );
    assert.equal(
        result.rows.find((r) => r.kind === "deals")!.data.contactId,
        "c",
    );
    assert.equal(
        (
            result.rows.find((r) => r.kind === "pipelines")!.data.stages as {
                category: string;
            }[]
        )[0].category,
        "won",
    );
});
test("CSV 따옴표·한국어·이름 조합·관계 매핑과 JSON 배열", () => {
    const value = createImportInput.parse({
        workspaceId: 8,
        source: "hubspot",
        namespace: "csv",
        format: "csv",
        csvKind: "contacts",
        content: 'ID,First,Last,회사\n1,"김,가상",고객,co1;co2\n',
        columns: { id: "ID", name: "First + Last", companyIds: "회사" },
    });
    const result = normalizeImport(value);
    assert.equal(result.rows[0].data.name, "김,가상 고객");
    assert.deepEqual(result.rows[0].data.companyIds, ["co1", "co2"]);
    assert.throws(() => normalizeImport({ ...value, content: "id,id\n1,2\n" }));
});
test("원본 ID 중복·필수 필드·예상 건수 누락을 명시", () => {
    const result = normalizeImport(
        input(
            "portable",
            {
                contacts: [
                    { id: "a", name: "첫 고객" },
                    { id: "a", name: "중복" },
                ],
                messages: [
                    {
                        id: "m",
                        conversationId: "v",
                        body: "내용",
                        authorName: "고객",
                    },
                ],
            },
            { expectedCounts: { contacts: 5 } },
        ),
    );
    assert.ok(
        result.rows.some((r) =>
            r.errors.includes("같은 자료에 원본 ID가 중복됩니다."),
        ),
    );
    assert.ok(result.rows.find((r) => r.kind === "messages")!.errors.length);
    assert.ok(result.errors.length);
});
test("해시·원본 UUID는 키 순서와 재이전에 안정적이며 원형 경로 차단", () => {
    assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
    assert.equal(sourceUuid("a", "b"), sourceUuid("a", "b"));
    assert.notEqual(sourceUuid("a", "b"), sourceUuid("other", "b"));
    assert.throws(() => pathValue({}, "__proto__.name"));
});
