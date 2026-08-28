import { test } from "node:test";
import assert from "node:assert";
import type { ContentBlock, Usage } from "@anthropic-ai/sdk/resources/messages";
import { extractText, extractSearchSources, toUsage, stripCitationTags } from "./claude-parse";

function textBlock(text: string): ContentBlock {
    return { type: "text", text, citations: null } as ContentBlock;
}

function searchResult(url: string, title: string) {
    return { type: "web_search_result", url, title, page_age: null, encrypted_content: "x" };
}

function searchOk(...results: ReturnType<typeof searchResult>[]): ContentBlock {
    return {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        caller: { type: "direct" },
        content: results,
    } as unknown as ContentBlock;
}

// content가 배열이 아니라 에러 객체로 오는 union의 다른 갈래.
function searchErr(errorCode: string): ContentBlock {
    return {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_2",
        caller: { type: "direct" },
        content: { type: "web_search_tool_result_error", error_code: errorCode },
    } as unknown as ContentBlock;
}

function serverToolUse(): ContentBlock {
    return {
        type: "server_tool_use",
        id: "srvtoolu_1",
        name: "web_search",
        input: { query: "test" },
        caller: { type: "direct" },
    } as unknown as ContentBlock;
}

// ── extractText ──

test("text 블록만 골라 이어붙인다 (B7/B8)", () => {
    const blocks = [textBlock("hello "), serverToolUse(), searchOk(), textBlock("world")];
    assert.equal(extractText(blocks), "hello world");
});

// 실측: 검색 응답은 text 블록이 여러 개로 쪼개져 온다
test("쪼개진 text 블록을 순서대로 전부 이어붙인다 (B7)", () => {
    const blocks = [textBlock('{"a"'), textBlock(":1"), textBlock("}")];
    assert.equal(extractText(blocks), '{"a":1}');
});

test("빈 blocks에서 빈 문자열을 반환한다 (throw 아님)", () => {
    assert.equal(extractText([]), "");
});

test("text 블록이 하나도 없으면 빈 문자열이다", () => {
    assert.equal(extractText([serverToolUse(), searchOk()]), "");
});

// ── extractSearchSources ──

test("web_search_result에서 url/title을 뽑는다 (B10)", () => {
    const blocks = [searchOk(searchResult("https://a.com", "A사"), searchResult("https://b.com", "B사"))];
    assert.deepEqual(extractSearchSources(blocks), [
        { url: "https://a.com", title: "A사" },
        { url: "https://b.com", title: "B사" },
    ]);
});

// 최대 함정: content가 union이라 에러 갈래에 .map을 호출하면 TypeError가 나고
// search.ts의 catch가 "정보 없음"으로 삼켜 조용히 전량 실패한다.
test("content가 에러인 블록은 건너뛰고 나머지는 계속 수집한다 (B9)", () => {
    const blocks = [
        searchErr("max_uses_exceeded"),
        searchOk(searchResult("https://c.com", "C사")),
    ];
    assert.deepEqual(extractSearchSources(blocks), [{ url: "https://c.com", title: "C사" }]);
});

test("에러 블록만 있으면 빈 배열이다 (B9)", () => {
    assert.deepEqual(extractSearchSources([searchErr("too_many_requests")]), []);
});

test("중복 url은 1건으로 dedupe한다 (B10)", () => {
    const blocks = [
        searchOk(searchResult("https://a.com", "A사"), searchResult("https://a.com", "A사 중복")),
    ];
    assert.deepEqual(extractSearchSources(blocks), [{ url: "https://a.com", title: "A사" }]);
});

test("title이 비어 있으면 url로 대체한다 (B10)", () => {
    const blocks = [searchOk(searchResult("https://d.com", ""))];
    assert.deepEqual(extractSearchSources(blocks), [{ url: "https://d.com", title: "https://d.com" }]);
});

test("검색 결과 블록이 없으면 빈 배열이다 (B9)", () => {
    assert.deepEqual(extractSearchSources([textBlock("no search")]), []);
});

// ── toUsage ──

test("input_tokens/output_tokens를 기존 usage 형태로 매핑한다 (B7/B8)", () => {
    const u = { input_tokens: 11625, output_tokens: 446 } as Usage;
    assert.deepEqual(toUsage(u), { promptTokens: 11625, completionTokens: 446 });
});

test("usage가 undefined면 0으로 채운다", () => {
    assert.deepEqual(toUsage(undefined), { promptTokens: 0, completionTokens: 0 });
});

// ── stripCitationTags ──
// 웹검색 경로에서 모델이 (cite index="21-1">텍스트</cite> 형태의 인용 태그를 본문에 섞는다.
// 그대로 두면 콜드메일 본문/회사 설명에 태그가 노출된다.

test("cite 태그를 벗기고 안쪽 텍스트만 남긴다 (B9)", () => {
    const s = '(cite index="21-1">주식회사 토스페이먼츠</cite>';
    assert.equal(stripCitationTags(s), "주식회사 토스페이먼츠");
});

test("여러 cite 태그를 모두 벗긴다 (B9)", () => {
    const s = '(cite index="6-2">간편결제</cite>, <cite index="6-3">해외결제</cite>';
    assert.equal(stripCitationTags(s), "간편결제, 해외결제");
});

test("여는 괄호 없는 <cite ...> 형태도 벗긴다 (B9)", () => {
    assert.equal(stripCitationTags('<cite index="4-1">2020년 출범</cite>합니다.'), "2020년 출범합니다.");
});

test("cite 태그가 없으면 원문을 그대로 둔다 (B9)", () => {
    assert.equal(stripCitationTags("평범한 문장입니다."), "평범한 문장입니다.");
});

test("JSON 문자열 안의 cite 태그도 벗긴다 (B9)", () => {
    const json = '{"industry": "(cite index="16-1">핀테크</cite>"}';
    assert.equal(stripCitationTags(json), '{"industry": "핀테크"}');
});

test("빈 문자열은 빈 문자열이다", () => {
    assert.equal(stripCitationTags(""), "");
});
