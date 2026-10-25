import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEV_PREVIEW_ASSET_DIR, resolveDevPreviewAsset, serveDevPreviewAsset } from "./development-preview-assets";

const PREVIEW_ENV = { NEXT_PUBLIC_APP_URL: "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app/" };
const ROOT = path.join(process.cwd(), DEV_PREVIEW_ASSET_DIR);
const get = (segments: string[] | undefined, env: Record<string, string | undefined>, method = "GET") =>
    serveDevPreviewAsset(new Request(`https://example.test/dev-start/${(segments ?? []).join("/")}`, { method }), segments, { env, root: ROOT });

test("체험 자료는 public/ 밖에 있어 정적 제공 경로로 노출되지 않는다", () => {
    assert.equal(existsSync(path.join(process.cwd(), "public", "dev-start")), false);
    assert.equal(existsSync(path.join(ROOT, "index.html")), true);
});

test("비체험 환경에서는 모든 체험 경로가 404다", async () => {
    for (const env of [{}, { NEXT_PUBLIC_APP_URL: "https://sendb.kr" }, { NEXT_PUBLIC_APP_URL: "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app.example.test" }]) {
        for (const segments of [undefined, ["index.html"], ["guide", "evidence.json"], ["esign-contract.pdf"]]) {
            for (const method of ["GET", "HEAD"]) {
                const response = await get(segments, env, method);
                assert.equal(response.status, 404);
                assert.equal(response.headers.get("cache-control"), "no-store");
                assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
                assert.equal(await response.text(), method === "HEAD" ? "" : "페이지를 찾을 수 없습니다.");
            }
        }
    }
});

test("체험 환경에서는 기존 링크 경로를 형식에 맞는 Content-Type으로 제공한다", async () => {
    const cases: Array<[string[], string]> = [
        [["index.html"], "text/html; charset=utf-8"],
        [["start.js"], "text/javascript; charset=utf-8"],
        [["start.css"], "text/css; charset=utf-8"],
        [["guide", "evidence.json"], "application/json; charset=utf-8"],
        [["esign-contract.pdf"], "application/pdf"],
        [["guide", "assets", "staff-draft.png"], "image/png"],
        [["guide", "assets", "merged-ai-history.jpg"], "image/jpeg"],
    ];
    for (const [segments, type] of cases) {
        const response = await get(segments, PREVIEW_ENV);
        assert.equal(response.status, 200, segments.join("/"));
        assert.equal(response.headers.get("content-type"), type);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(path.join(ROOT, ...segments)));
    }
    const head = await get(["index.html"], PREVIEW_ENV, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const start = await get(undefined, PREVIEW_ENV);
    assert.equal(start.status, 307);
    assert.equal(start.headers.get("location"), "/dev-start/index.html");
    assert.equal((await get(["missing.html"], PREVIEW_ENV)).status, 404);
    assert.equal((await get(["guide"], PREVIEW_ENV)).status, 404);
});

test("경로 탐색·숨김 파일·허용하지 않은 형식은 체험 환경에서도 404다", async () => {
    // Next가 %2F·%2E%2E를 풀어 넘긴 조각(guide/../..)도 이 단계에서 막힌다.
    for (const segments of [["..", "package.json"], ["guide", "..", "..", "package.json"], ["guide/../../package.json"], ["guide\\..\\..\\package.json"], ["C:", "Windows", "win.ini"], [".env"], ["guide", ".hidden.json"], ["index.html\0.png"], [""], ["."], ["start.ts"], ["guide", "index.HTM"]]) {
        assert.equal(resolveDevPreviewAsset(segments, ROOT), null, segments.join("/"));
        assert.equal((await get(segments, PREVIEW_ENV)).status, 404, segments.join("/"));
    }
    // 풀리지 않은 %2F는 파일 이름의 일부일 뿐이라 폴더 안에서 찾고 없으면 404다.
    assert.equal((await get(["..%2Fpackage.json"], PREVIEW_ENV)).status, 404);
});

test("evidence.json에 작업자 PC 절대 경로가 없다", () => {
    const text = readFileSync(path.join(ROOT, "guide", "evidence.json"), "utf8");
    assert.doesNotMatch(text, /(?<![A-Za-z])[A-Za-z]:[\\/]/); // https:// 는 제외
    assert.doesNotMatch(text, /\/Users\//);
});
