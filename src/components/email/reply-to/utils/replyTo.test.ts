import { test } from "node:test";
import assert from "node:assert";
import { MX_NONE_TTL_MS } from "@/lib/reply-to-rules";
import {
    POOL_REPLY_NOTICE_TEXT,
    POOL_REPLY_RECHECK_TEXT,
    poolNoMxDomains,
    REPLY_SUMMARY_TEXT,
    replySummaryWarning,
} from "./replyTo";

// DESIGN-3 화면 — 답장은 보낸 주소로 간다 (NHN이 Reply-To를 받지 않는다). 규칙 요약 칸 "답장"과 발신 묶음 칸 안내

const entries = [
    { domain: "matchesplan.me", mx: "none" as const },
    { domain: "MatchesPlan.me", mx: "none" as const },
    { domain: "matchesplan.com", mx: "ok" as const },
    { domain: "flaky.example", mx: "unknown" as const },
    { domain: null, mx: null },
    { domain: "sendb.kr", mx: "none" as const },
];

test("요약 칸: 답장은 보낸 주소로 간다", () => {
    assert.equal(REPLY_SUMMARY_TEXT, "보낸 주소로 갑니다");
});

test("묶음 안내 글: MX를 연결해야 답장이 온다 (워크스페이스 설정으로 보내지 않는다)", () => {
    assert.equal(
        POOL_REPLY_NOTICE_TEXT,
        "이 주소들은 답장을 받을 수 없습니다 — 도메인에 메일 수신(MX)을 연결해야 답장이 옵니다"
    );
    assert.equal(POOL_REPLY_NOTICE_TEXT.includes("워크스페이스"), false);
});

test("묶음 안내 끝 줄: MX를 연결한 뒤 언제 다시 확인되는지 — 서버가 'MX 없음'을 기억하는 10분 (REVIEW-4 F1)", () => {
    assert.equal(
        POOL_REPLY_RECHECK_TEXT,
        "MX를 연결했다면 10분쯤 뒤 이 화면을 다시 열면 확인됩니다 (DNS 반영이 늦으면 더 걸릴 수 있습니다)."
    );
    assert.equal(POOL_REPLY_RECHECK_TEXT.includes(`${MX_NONE_TTL_MS / 60_000}분`), true);
});

test("MX 없는 도메인: 소문자, 중복 없이, 묶음 순서", () => {
    assert.deepEqual(poolNoMxDomains(entries), ["matchesplan.me", "sendb.kr"]);
});

test("MX 없는 도메인: 모두 받거나(ok) 확인하지 못한(unknown·조회 안 함) 도메인뿐이면 없음, 목록이 없어도 없음", () => {
    assert.deepEqual(poolNoMxDomains(entries.filter((e) => e.mx !== "none")), []);
    assert.deepEqual(poolNoMxDomains([]), []);
    assert.deepEqual(poolNoMxDomains(null), []);
    assert.deepEqual(poolNoMxDomains(undefined), []);
});

test("요약 칸 노란 글: 받을 수 없는 도메인이 있으면 몇 곳인지, 없으면 null", () => {
    assert.equal(replySummaryWarning(["matchesplan.me", "sendb.kr"]), "받을 수 없는 도메인 2곳 — 발신 프로필 칸 참고");
    assert.equal(replySummaryWarning(["matchesplan.me"]), "받을 수 없는 도메인 1곳 — 발신 프로필 칸 참고");
    assert.equal(replySummaryWarning([]), null);
});
