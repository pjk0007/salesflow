import assert from "node:assert/strict";
import test from "node:test";
import { navItems, bottomNavItems, getBreadcrumbItems } from "./navigation";

test("사이드바의 모든 경로는 메뉴와 같은 한국어 경로 이름을 쓴다", () => {
    for (const item of [...navItems, ...bottomNavItems]) {
        if (item.href === "/") assert.deepEqual(getBreadcrumbItems(item.href), []);
        else assert.equal(getBreadcrumbItems(item.href).at(-1)?.label, item.label);
    }
    for (const path of ["customer-ai", "customer-imports", "customer-webhooks", "customer-workflows"]) {
        assert.match(getBreadcrumbItems(`/${path}`)[0].label, /[가-힣]/);
    }
});

test("숫자·UUID 내부 식별자를 숨기고 이름 override 및 실제 상위 탭 링크를 보존한다", () => {
    const uuid = "00000000-0000-4000-8000-000000000123";
    for (const id of ["123", uuid]) {
        assert.deepEqual(getBreadcrumbItems(`/tracker/visitors/${id}/journey`).map(x => x.label), ["트래커", "방문자", "상세", "고객 여정"]);
        assert.equal(getBreadcrumbItems(`/tracker/visitors/${id}`)[1].href, "/tracker");
        assert.equal(getBreadcrumbItems(`/tracker/visitors/${id}`, { [id]: "고객 이름" }).at(-1)?.label, "고객 이름");
    }
    for (const segment of ["templates", "links", "ai-auto"]) {
        assert.equal(getBreadcrumbItems(`/email/${segment}/45`)[1].href, `/email?tab=${segment}`);
    }
    assert.equal(getBreadcrumbItems("/alimtalk/links/new")[1].href, "/alimtalk?tab=links");
    assert.deepEqual(getBreadcrumbItems("/records/45/journey").map(x => [x.label, x.href]), [["레코드", "/records"], ["상세", "/records?id=45"], ["고객 여정", "/records/45/journey"]]);
    assert.equal(getBreadcrumbItems("/email/templates/new").at(-1)?.label, "새로 만들기");
});
