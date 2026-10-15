import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImport } from "@/lib/customer-imports/adapters";
import { createImportInput } from "@/lib/customer-imports/rules";
import { ChannelChunkError, splitChannelBundle, type ChannelChunkBundle } from "./chunks";
const options = { workspaceId: 8, namespace: "fictional-channel" };
const bundle = (): ChannelChunkBundle => ({
    users: [{ id: "u", type: "member", memberId: "verified-site-user", profile: { name: "가상 고객" } }],
    managers: [{ id: "manager", name: "가상 상담원" }], bots: [{ id: "bot", name: "가상 봇" }],
    userChats: [{ id: "chat", userId: "u", title: "가상 이전 문의", state: "closed" }],
    messages: [
        { id: "message-1", chatId: "chat", personType: "user", personId: "u", plainText: "가상 문의", createdAt: 1715000000000 },
        { id: "message-2", chatId: "chat", personType: "manager", personId: "manager", plainText: "가상 직원 메모", options: ["private"], createdAt: 1715000001000, files: [{ key: "fictional-file-key", name: "가상 첨부.pdf", size: 5 }] },
        { id: "message-3", chatId: "chat", personType: "bot", personId: "bot", plainText: "가상 자동 안내", createdAt: 1715000002000 },
    ], hasNext: false,
});
test("실제 importer 입력·행·namespace와 원본 private/bot/첨부를 유지하고 의존 행을 구분", () => {
    const source = bundle(), plan = splitChannelBundle(source, { ...options, maxRows: 4 });
    assert.deepEqual(plan.chunks.map(chunk => chunk.phase), ["contacts", "conversations", "messages", "messages"]);
    const primaries = plan.chunks.flatMap(chunk => normalizeImport(chunk.input).rows.filter(row => chunk.primaryCounts[row.kind] > 0));
    assert.equal(plan.manifest.uniqueCounts.contacts, 1);
    assert.equal(plan.manifest.uniqueCounts.conversations, 1);
    assert.equal(plan.manifest.uniqueCounts.messages, 3);
    assert.equal(primaries.filter(row => row.kind === "messages").length, 3);
    assert.equal(plan.manifest.importedCounts.contacts, 4);
    assert.equal(plan.manifest.dependencyCounts.contacts, 3);
    for (const chunk of plan.chunks) {
        const input = createImportInput.parse(chunk.input), normalized = normalizeImport(input);
        assert.equal(input.namespace, options.namespace);
        assert.equal(chunk.normalizedRows, normalized.rows.length);
        assert.ok(chunk.normalizedRows <= 4);
        assert.deepEqual(normalized.errors, []);
        assert.ok(normalized.rows.every(row => !row.errors.length));
        for (const [kind, count] of Object.entries(chunk.expectedCounts))
            assert.equal(normalized.rows.filter(row => row.kind === kind).length, count);
    }
    const messages = plan.chunks.flatMap(chunk => normalizeImport(chunk.input).rows.filter(row => row.kind === "messages"));
    assert.equal(messages.find(row => row.sourceId === "chat/message-2")?.data.messageKind, "note");
    assert.equal(messages.find(row => row.sourceId === "chat/message-3")?.data.authorName, "가상 봇");
    assert.deepEqual(messages.find(row => row.sourceId === "chat/message-2")?.original, source.messages[1]);
});
test("실제 10,000 normalized 행 한도를 초과한 원본을 순서와 unique ID를 유지해 분할", () => {
    const source = bundle();
    source.messages = Array.from({ length: 10_005 }, (_, index) => ({ ...source.messages[0], id: "message-" + String(index).padStart(5, "0"), createdAt: 1715000000000 + index }));
    const plan = splitChannelBundle(source, options);
    const messageChunks = plan.chunks.filter(chunk => chunk.phase === "messages");
    assert.equal(messageChunks.length, 2);
    assert.equal(messageChunks[0].normalizedRows, 10_000);
    assert.equal(messageChunks[0].expectedCounts.messages, 9_998);
    const ids = messageChunks.flatMap(chunk => normalizeImport(chunk.input).rows.filter(row => row.kind === "messages").map(row => row.sourceId));
    assert.equal(new Set(ids).size, 10_005);
    assert.equal(ids.length, 10_005);
    assert.equal(plan.manifest.uniqueCounts.messages, 10_005);
});
test("UTF16 문자와 UTF8 바이트 한도를 각각 적용하고 관계 closure를 함께 옮김", () => {
    const source = bundle();
    source.messages = Array.from({ length: 6 }, (_, index) => ({ ...source.messages[0], id: "message-" + index, plainText: "가".repeat(1000) }));
    for (const limits of [{ maxCharacters: 2800 }, { maxBytes: 5000 }]) {
        const plan = splitChannelBundle(source, { ...options, ...limits });
        assert.ok(plan.chunks.filter(chunk => chunk.phase === "messages").length >= 3);
        for (const chunk of plan.chunks) {
            assert.ok(chunk.characters <= (limits.maxCharacters ?? 5_000_000));
            assert.ok(chunk.bytes <= (limits.maxBytes ?? 20_000_000));
            for (const message of chunk.bundle.messages) {
                assert.ok(chunk.bundle.userChats.some(chat => chat.id === message.chatId));
                assert.ok(chunk.bundle.users.some(user => user.id === "u"));
            }
        }
    }
});
test("미완료/빠진 고객·상담·작성자 관계/단일 초대형 행은 조용히 누락하지 않음", () => {
    const cases: [ChannelChunkBundle, ChannelChunkError["code"]][] = [];
    const incomplete = bundle(); incomplete.hasNext = true; cases.push([incomplete, "source_incomplete"]);
    const user = bundle(); user.users = []; cases.push([user, "missing_dependency"]);
    const chat = bundle(); chat.userChats = []; cases.push([chat, "missing_dependency"]);
    const actor = bundle(); actor.managers = []; cases.push([actor, "missing_dependency"]);
    for (const [source, code] of cases) assert.throws(() => splitChannelBundle(source, options), error => error instanceof ChannelChunkError && error.code === code);
    assert.throws(() => splitChannelBundle(bundle(), { ...options, maxRows: 2 }), error => error instanceof ChannelChunkError && error.code === "item_too_large");
    const oversized = bundle(); oversized.messages[0].originalExtra = "x".repeat(5_000_000);
    assert.throws(() => splitChannelBundle(oversized, options), error => error instanceof ChannelChunkError && error.code === "item_too_large");
});
test("실제 importer 행 검증 실패와 중복 ID의 상충 원본을 명시적으로 거절", () => {
    const invalid = bundle(); invalid.messages[0].createdAt = "invalid-date";
    assert.throws(() => splitChannelBundle(invalid, options), error => error instanceof ChannelChunkError && error.code === "row_invalid");
    const duplicates = bundle(); duplicates.users.push({ ...duplicates.users[0], memberId: "different" });
    assert.throws(() => splitChannelBundle(duplicates, options), error => error instanceof ChannelChunkError && error.code === "duplicate_source");
    const identical = bundle(); identical.users.push({ ...identical.users[0] });
    const plan = splitChannelBundle(identical, options);
    assert.equal(plan.manifest.uniqueCounts.contacts, 1);
    assert.equal(plan.manifest.duplicateRawCounts.users, 1);
});
test("정렬이 달라도 안정적인 chunk 내용과 source ID를 만들고 빈 원본도 누락 없이 표현", () => {
    const source = bundle(), shuffled = structuredClone(source); shuffled.messages.reverse();
    assert.deepEqual(splitChannelBundle(source, options).chunks.map(chunk => chunk.sha256), splitChannelBundle(shuffled, options).chunks.map(chunk => chunk.sha256));
    const empty = splitChannelBundle({ users: [], managers: [{ id: "manager" }], bots: [], userChats: [], messages: [], hasNext: false }, options);
    assert.equal(empty.chunks.length, 0);
    assert.equal(empty.manifest.rawUniqueCounts.managers, 1);
    assert.equal(empty.manifest.uniqueCounts.messages, 0);
});
