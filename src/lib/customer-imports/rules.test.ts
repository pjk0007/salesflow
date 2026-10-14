import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeImport } from "./adapters";
import {
    createImportInput,
    date,
    fingerprint,
    pathValue,
    sourceUuid,
} from "./rules";
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
