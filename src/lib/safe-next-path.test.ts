import { test } from "node:test";
import assert from "node:assert";
import { loginPathFor, safeNextPath } from "./safe-next-path";

test("로그인 뒤 돌아갈 주소는 같은 사이트 경로만 (DV-12)", () => {
    assert.equal(safeNextPath("/records?id=4242"), "/records?id=4242");
    assert.equal(safeNextPath("/records/4242/journey"), "/records/4242/journey");
    assert.equal(safeNextPath("https://evil.test/x"), null);
    assert.equal(safeNextPath("//evil.test/x"), null);
    assert.equal(safeNextPath("/\\evil.test"), null);
    assert.equal(safeNextPath("/login?next=/x"), null);
    assert.equal(safeNextPath(""), null);
    assert.equal(safeNextPath(null), null);
});

test("UX-273 구글 챗 카드의 여정 링크(앵커 포함)는 로그인 뒤 같은 주소·앵커로 돌아온다", () => {
    for (const here of ["/records/4242/journey#lead-followup", "/tracker/visitors/77/journey", "/records?id=4242&tab=x#a"]) {
        const login = new URL(loginPathFor(here), "https://sendb.kr");
        assert.equal(login.pathname, "/login");
        assert.equal(safeNextPath(login.searchParams.get("next")), here);
    }
    assert.equal(loginPathFor("/"), "/login");
    assert.equal(loginPathFor(""), "/login");
    assert.equal(loginPathFor("/login?next=/x"), "/login", "로그인 화면으로 다시 돌아가게 하지 않는다");
});
