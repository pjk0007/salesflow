// 실제 provider/queue 소스 실행. 브라우저·쿠키·네트워크·DB는 사용하지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

async function harness() {
    let current = { orgId: 'A', userId: 'staff', membershipId: 1, tokenVersion: 0, role: 'owner', organizations: [] };
    let failMe = false, onLogout = async () => { current = null; }, onSwitch = async () => {};
    let cursor = 0, mounted = false;
    const slots = [], effects = [], events = [], navigations = [];
    const state = initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    };
    const react = {
        createContext: () => ({ Provider: 'provider' }), useState: state,
        useRef: value => state(() => ({ current: value }))[0], useCallback: f => f,
        useEffect: f => { if (!mounted) effects.push(f); },
    };
    const compile = (relative, imports) => {
        const source = fs.readFileSync(path.join(root, relative), 'utf8');
        const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        const exports = {};
        vm.runInNewContext('(function(require,exports){' + js + '})', {
            console: { error() {} }, window: { location: { replace: url => { navigations.push(['replace', url]); events.push('replace:' + url); } } },
            fetch: async (url, options) => {
                if (url === '/api/org/switch') {
                    const id = JSON.parse(options.body).orgId;
                    events.push('switch-start:' + id); await onSwitch(id);
                    current = { ...current, orgId: id, membershipId: id === 'B' ? 2 : 3 };
                    events.push('switch-response:' + id);
                    return { ok: true, json: async () => ({ success: true }) };
                }
                if (url === '/api/auth/logout') { events.push('logout-start'); await onLogout(); events.push('logout-response'); return { ok: false }; }
                throw Error('외부 요청 금지: ' + url);
            },
        })(name => { if (Object.hasOwn(imports, name)) return imports[name]; throw Error('허용하지 않은 의존성: ' + name); }, exports);
        return exports;
    };
    const queue = compile('components/inbox/hooks/session-transition-queue.ts', {});
    const provider = compile('contexts/SessionContext.tsx', {
        react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        'next/navigation': { useRouter: () => ({ push: url => navigations.push(['push', url]) }) },
        '@/components/inbox/hooks/session-transition-queue': queue,
        '@/lib/session-request': { fetchSessionResponse: async () => {
            if (failMe) { events.push('me:error'); throw Error('세션 조회 실패'); }
            events.push('me:' + (current?.orgId ?? 'null'));
            return current ? { success: true, user: { ...current } } : { success: false };
        } },
    });
    const render = () => { cursor = 0; const value = provider.SessionProvider({ children: null }).props.value; mounted = true; return value; };
    render(); effects.forEach(f => f()); await tick();
    return {
        render, events, navigations, setCurrent: value => { current = value; },
        changeRole: role => { current = { ...current, role }; }, failMe: value => { failMe = value; },
        onLogout: f => { onLogout = f; }, onSwitch: f => { onSwitch = f; },
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

for (const failure of ['http', 'network']) test(`B→logout ${failure} 실패 뒤 실제 /me:B는 /login으로 오인하지 않는다`, async () => {
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

for (const same of [true, false]) test(`refresh 오류 뒤 ${same ? '동일' : '다른'} identity 복구`, async () => {
    const h = await harness(); h.failMe(true); await h.render().refreshSession();
    assert.deepEqual(h.navigations, []); assert.equal(h.render().user, null); assert.ok(h.render().sessionError);
    h.failMe(false);
    if (!same) h.setCurrent({ orgId: 'B', userId: 'staff', membershipId: 2, tokenVersion: 0, role: 'owner', organizations: [] });
    await h.render().refreshSession();
    assert.deepEqual(h.navigations, same ? [] : [['replace', '/']]);
    assert.equal(h.render().user?.orgId ?? null, same ? 'A' : null);
});
