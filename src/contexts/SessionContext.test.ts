// 실제 provider/queue 소스 실행. 브라우저·쿠키·네트워크·DB는 사용하지 않는다.
// 한계: React를 쓰지 않고 훅을 직접 모사한다. useEffect는 최초 렌더 뒤 1회만 실행하고 useCallback은 함수를 그대로 돌려주므로,
// 의존성 변경에 따른 effect 재실행·정리(cleanup)와 렌더 사이 콜백 교체는 이 시험이 확인하지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { useSession } from "./SessionContext";

type SessionValue = ReturnType<typeof useSession>;
type Identity = { orgId: string; userId: string; membershipId: number; tokenVersion: number; role: string; organizations: unknown[] };
type Listener = (event: { type: string } & Record<string, unknown>) => void;
type Exports = Record<string, unknown>;
type Provider = { SessionProvider: (props: { children: null }) => { props: { value: SessionValue } } };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let release = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

async function harness() {
    let current: Identity | null = { orgId: "A", userId: "staff", membershipId: 1, tokenVersion: 0, role: "owner", organizations: [] };
    let failMe = false;
    let onLogout = async () => { current = null; };
    let onSwitch = async (id: string) => { void id; };
    let cursor = 0, mounted = false;
    const slots: unknown[] = [], effects: (() => unknown)[] = [], events: string[] = [];
    const navigations: [string, string][] = [], announcements: [string, string][] = [];
    const listeners = new Map<string, Set<Listener>>();
    const emit = (type: string, extra: Record<string, unknown> = {}) => { for (const listener of listeners.get(type) ?? []) listener({ type, ...extra }); };
    const signedIn = () => { if (!current) throw Error("로그인 상태가 아님"); return current; };
    const state = <T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
        return [slots[index] as T, value => { slots[index] = typeof value === "function" ? (value as (previous: T) => T)(slots[index] as T) : value; }];
    };
    const react = {
        createContext: () => ({ Provider: "provider" }), useState: state,
        useRef: <T>(value: T) => state(() => ({ current: value }))[0], useCallback: <F>(f: F) => f,
        useEffect: (f: () => unknown) => { if (!mounted) effects.push(f); },
    };
    const compile = (relative: string, imports: Record<string, unknown>): Exports => {
        const source = fs.readFileSync(path.join(root, relative), "utf8");
        const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        const exports: Exports = {};
        const run = vm.runInNewContext("(function(require,exports){" + js + "})", {
            console: { error() {} },
            window: {
                location: { replace: (url: string) => { navigations.push(["replace", url]); events.push("replace:" + url); } },
                addEventListener: (type: string, listener: Listener) => { const set = listeners.get(type) ?? new Set<Listener>(); set.add(listener); listeners.set(type, set); },
                removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
            },
            localStorage: { setItem: (key: string, value: string) => { announcements.push([key, value]); } },
            fetch: async (url: string, options: { body: string }) => {
                if (url === "/api/org/switch") {
                    const id: string = JSON.parse(options.body).orgId;
                    events.push("switch-start:" + id); await onSwitch(id);
                    current = { ...signedIn(), orgId: id, membershipId: id === "B" ? 2 : 3 };
                    events.push("switch-response:" + id);
                    return { ok: true, json: async () => ({ success: true }) };
                }
                if (url === "/api/auth/logout") { events.push("logout-start"); await onLogout(); events.push("logout-response"); return { ok: false }; }
                throw Error("외부 요청 금지: " + url);
            },
        }) as (require: (name: string) => unknown, exports: Exports) => void;
        run(name => { if (Object.hasOwn(imports, name)) return imports[name]; throw Error("허용하지 않은 의존성: " + name); }, exports);
        return exports;
    };
    const queue = compile("components/inbox/hooks/session-transition-queue.ts", {});
    const sessionSync = compile("lib/session-sync.ts", {});
    const provider = compile("contexts/SessionContext.tsx", {
        react, "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }) },
        "next/navigation": { useRouter: () => ({ push: (url: string) => navigations.push(["push", url]) }) },
        "@/components/inbox/hooks/session-transition-queue": queue,
        "@/lib/session-sync": sessionSync,
        "@/lib/session-request": { fetchSessionResponse: async () => {
            if (failMe) { events.push("me:error"); throw Error("세션 조회 실패"); }
            events.push("me:" + (current?.orgId ?? "null"));
            return current ? { success: true, user: { ...current } } : { success: false };
        } },
    }) as Provider;
    const render = () => { cursor = 0; const value = provider.SessionProvider({ children: null }).props.value; mounted = true; return value; };
    render(); effects.forEach(f => f()); await tick();
    return {
        render, events, navigations, announcements, emit, setCurrent: (value: Identity | null) => { current = value; },
        changeRole: (role: string) => { current = { ...signedIn(), role }; }, failMe: (value: boolean) => { failMe = value; },
        onLogout: (f: () => Promise<void>) => { onLogout = f; }, onSwitch: (f: (id: string) => Promise<void>) => { onSwitch = f; },
    };
}

test('B→지연 logout은 중간 문서 이동 없이 마지막 /me:null 뒤 로그인으로 한 번 이동한다', async () => {
    const h = await harness(), wait = gate();
    h.onLogout(async () => { await wait.promise; h.setCurrent(null); });
    const b = h.render().switchOrg('B'), logout = h.render().logout();
    await tick();
    assert.ok(h.events.includes('logout-start'));
    assert.deepEqual(h.navigations, []);
    assert.equal(h.render().user, null);
    assert.equal(h.render().isSessionChanging, true);
    wait.release(); await Promise.all([b, logout]);
    assert.deepEqual(h.navigations, [['replace', '/login']]);
    assert.equal(h.render().user, null);
});

test('B→C는 최종 C 확인 뒤 한 번만 문서를 이동한다', async () => {
    const h = await harness(), wait = gate();
    h.onSwitch(async id => { if (id === 'C') await wait.promise; });
    const b = h.render().switchOrg('B'), c = h.render().switchOrg('C');
    await tick(); assert.deepEqual(h.navigations, []); assert.equal(h.render().user, null);
    wait.release(); await Promise.all([b, c]);
    assert.deepEqual(h.navigations, [['replace', '/']]);
    assert.equal(h.events.at(-2), 'me:C');
});

for (const failure of ['http', 'network'] as const) test(`B→logout ${failure} 실패 뒤 실제 /me:B는 /login으로 오인하지 않는다`, async () => {
    const h = await harness();
    h.onLogout(async () => { if (failure === 'network') throw Error('응답 불명'); });
    await Promise.all([h.render().switchOrg('B'), h.render().logout()]);
    assert.deepEqual(h.navigations, [['replace', '/']]);
    assert.equal(h.render().user, null);
});

test('B→logout과 /me 모두 불명은 이동 없이 숨기며, 재조회 B로 복구하면 캐시를 폐기한다', async () => {
    const h = await harness();
    h.onLogout(async () => { h.failMe(true); throw Error('응답 불명'); });
    await Promise.all([h.render().switchOrg('B'), h.render().logout()]);
    assert.deepEqual(h.navigations, []); assert.equal(h.render().user, null);
    assert.ok(h.render().sessionError); assert.equal(h.render().isLoading, false);
    h.failMe(false); await h.render().refreshSession();
    assert.deepEqual(h.navigations, [['replace', '/']]); assert.equal(h.render().user, null);
});

test('동일 조직 refresh의 권한 변경도 기존 캐시 노출 없이 한 번만 reload한다', async () => {
    const h = await harness(); h.changeRole('member');
    await h.render().refreshSession(); await h.render().refreshSession();
    assert.deepEqual(h.navigations, [['replace', '/']]); assert.equal(h.render().user, null);
});

for (const same of [true, false] as const) test(`refresh 오류 뒤 ${same ? '동일' : '다른'} identity 복구`, async () => {
    const h = await harness(); h.failMe(true); await h.render().refreshSession();
    assert.deepEqual(h.navigations, []); assert.equal(h.render().user, null); assert.ok(h.render().sessionError);
    h.failMe(false);
    if (!same) h.setCurrent({ orgId: 'B', userId: 'staff', membershipId: 2, tokenVersion: 0, role: 'owner', organizations: [] });
    await h.render().refreshSession();
    assert.deepEqual(h.navigations, same ? [] : [['replace', '/']]);
    assert.equal(h.render().user?.orgId ?? null, same ? 'A' : null);
});

// UX-010 같은 계정의 다른 탭이 세션 쿠키를 바꾼 경우
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
test('다른 탭의 조직 전환 알림을 받으면 캐시를 숨기고 새 세션 확인 뒤 홈을 한 번 다시 연다', async () => {
    const h = await harness();
    assert.equal(h.render().user?.orgId, 'A');
    h.setCurrent({ orgId: 'B', userId: 'staff', membershipId: 2, tokenVersion: 0, role: 'owner', organizations: [] });
    h.emit('storage', { key: 'other-key' }); await settle();
    assert.deepEqual(h.navigations, []);
    h.emit('storage', { key: 'sendb:session-changed' }); await settle();
    assert.deepEqual(h.navigations, [['replace', '/']]);
    assert.equal(h.render().user, null);
    assert.deepEqual(h.announcements, [], '다른 탭이 바꾼 변경을 되알리지 않는다');
});

test('탭 복귀 때 세션이 그대로면 화면을 유지하고, 확인 실패도 화면을 숨기지 않는다', async () => {
    const h = await harness();
    h.emit('focus'); await settle();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.render().user?.orgId, 'A');
    assert.equal(h.render().isSessionChanging, false);
    h.failMe(true);
    h.emit('storage', { key: 'sendb:session-changed' }); await settle();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.render().user?.orgId, 'A');
    assert.equal(h.render().sessionError, null);
});

test('다른 탭 로그아웃 뒤 탭 복귀는 로그인으로 보낸다', async () => {
    const h = await harness();
    h.setCurrent(null);
    h.emit('focus'); await settle();
    assert.deepEqual(h.navigations, [['replace', '/login']]);
});

test('이 탭의 조직 전환이 세션을 바꿨을 때만 다른 탭에 알린다', async () => {
    const h = await harness();
    await h.render().switchOrg('B');
    assert.equal(h.announcements.length, 1);
    assert.equal(h.announcements[0][0], 'sendb:session-changed');
    const same = await harness();
    same.onSwitch(async () => { throw Error('응답 불명'); });
    await same.render().switchOrg('B');
    assert.deepEqual(same.announcements, []);
});
