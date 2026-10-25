// 실제 컴포넌트의 이벤트·상태 로직을 실행한다. DOM/레이아웃 검증은 별도이며 DB·네트워크를 열지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const tick = () => new Promise(resolve => setImmediate(resolve));
const event = { preventDefault() {}, stopPropagation() {} };
const plain = value => JSON.parse(JSON.stringify(value));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
    ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type, predicate = () => true) => {
    const match = nodes(tree).find(node => node.type === type && predicate(node.props));
    assert.ok(match, `요소 없음: ${type}`);
    return match.props;
};
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree)
    : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);

function harness(relative, overrides = {}, globals = {}) {
    let cursor = 0;
    const slots = [], effects = [], notices = [];
    const useState = initial => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    };
    const react = {
        useState, useRef: initial => useState(() => ({ current: initial }))[0],
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect(fn, deps) {
            const [before, save] = useState(undefined);
            if (!before || deps.some((value, i) => value !== before[i])) { effects.push(fn); save(deps); }
        },
    };
    const jsx = (type, props) => ({ type, props });
    const imports = {
        react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        sonner: { toast: { success: m => notices.push(['success', m]), error: m => notices.push(['error', m]) } },
        '@/lib/utils': { cn: (...args) => args.filter(Boolean).join(' ') },
        '@dnd-kit/core': { useSensors: () => [], useSensor: () => null },
        ...overrides,
    };
    const exports = {};
    const filename = new URL(relative, import.meta.url);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext('(function(require,exports){' + code + '})', {
        console, URLSearchParams, ...globals,
    })(name => {
        if (Object.hasOwn(imports, name)) return imports[name];
        if (name.startsWith('@/components/') || name.startsWith('./') || name === 'lucide-react' || name.startsWith('@dnd-kit/')) {
            return new Proxy({}, { get: (_, key) => key === '__esModule' ? true : key });
        }
        throw Error('허용하지 않은 의존성: ' + name);
    }, exports);
    return { notices, render(props = {}) {
        cursor = 0;
        const tree = exports.default(props);
        effects.splice(0).forEach(fn => fn());
        return tree;
    } };
}

test('UX-030 원래 값·빈 값·선택 옵션을 실제 편집 저장 요청으로 전달한다', async () => {
    const saved = [];
    const h = harness('./EditFieldDialog.tsx');
    const props = { open: true, onOpenChange() {}, field: {
        id: 30, key: 'date', label: '확인일', fieldType: 'date', category: '기존 분류',
        defaultValue: '2026-10-25', cellClassName: 'text-red-500', defaultWidth: 120,
    }, onSubmit: async (id, input) => { saved.push([id, input]); return { success: true }; } };
    h.render(props);
    let tree = h.render(props);
    find(tree, 'form').onSubmit(event); await tick();
    assert.equal(saved[0][1].category, '기존 분류');
    assert.equal(saved[0][1].defaultValue, '2026-10-25');
    find(tree, 'Input', p => p.value === '기존 분류').onChange({ target: { value: '' } });
    find(tree, 'DatePicker').onChange('');
    find(tree, 'button', p => text(p.children) === '기본').onClick();
    tree = h.render(props);
    find(tree, 'form').onSubmit(event); await tick();
    assert.deepEqual(plain(saved[1]), [30, { ...plain(saved[0][1]), category: '', defaultValue: '', cellClassName: '' }]);
    const selectProps = { ...props, field: { ...props.field, fieldType: 'select', options: ['A', 'B'], defaultValue: 'B' } };
    h.render(selectProps); tree = h.render(selectProps);
    find(tree, 'form').onSubmit(event); await tick();
    assert.deepEqual(plain(saved[2][1].options), ['A', 'B']);
    assert.equal(saved[2][1].defaultValue, 'B');
});

test('UX-031 워크스페이스 변경은 파티션·폼을 비우고 정확한 파티션으로 저장한다', async () => {
    let workspace, partition, fail = false;
    const saved = [];
    const h = harness('./AutoEnrichTab.tsx', {
        '@/hooks/useWorkspaces': { useWorkspaces: () => ({ workspaces: [{ id: 1, name: '첫째' }, { id: 2, name: '둘째' }] }) },
        '@/hooks/usePartitions': { usePartitions: id => { workspace = id; return { partitionTree: { ungrouped: [{ id: id * 10, name: '파티션' }], folders: [] } }; } },
        '@/hooks/useFields': { useFields: () => ({ fields: [{ key: 'company', label: '회사' }, { key: 'website', label: '웹사이트' }] }) },
        '@/hooks/useAutoEnrich': { useAutoEnrichRules: id => { partition = id; return { rules: [], createRule: async value => {
            if (fail) throw Error('offline'); saved.push(value); return { success: true };
        } }; } },
    });
    let tree = h.render();
    assert.equal(workspace, 1);
    const selects = () => nodes(tree).filter(n => n.type === 'Select');
    selects()[1].props.onValueChange('10'); tree = h.render();
    find(tree, 'Button', p => text(p.children).includes('규칙 추가')).onClick(); tree = h.render();
    selects()[0].props.onValueChange('2'); tree = h.render();
    assert.equal(workspace, 2); assert.equal(partition, null);
    assert.equal(find(tree, 'Dialog').open, false);
    selects()[1].props.onValueChange('20'); tree = h.render();
    find(tree, 'Button', p => text(p.children).includes('규칙 추가')).onClick(); tree = h.render();
    find(tree, 'Select', p => p.onValueChange && p.value === '').onValueChange('company'); tree = h.render();
    find(tree, 'Checkbox', p => p.id === 'target-website').onCheckedChange(); tree = h.render();
    fail = true;
    await find(tree, 'Button', p => text(p.children) === '저장').onClick(); tree = h.render();
    assert.equal(find(tree, 'Dialog').open, true);
    assert.equal(find(tree, 'Button', p => text(p.children) === '저장').disabled, false);
    assert.equal(h.notices.at(-1)[0], 'error');
    fail = false;
    await find(tree, 'Button', p => text(p.children) === '저장').onClick();
    assert.deepEqual(plain(saved), [{ partitionId: 20, searchField: 'company', targetFields: ['website'] }]);
});

test('UX-032 다른 카드 편집·삭제는 클릭한 타입을 사용하고 네트워크 실패 뒤 복구한다', async () => {
    const writes = [];
    let fail = true;
    const h = harness('./FieldTypeManagementTab.tsx', {
        '@/hooks/useFieldTypes': { useFieldTypes: () => ({ fieldTypes: [
            { id: 1, name: '첫째', description: '설명1' }, { id: 2, name: '둘째', description: '설명2' },
        ], updateType: async (...args) => { if (fail) throw Error('offline'); writes.push(args); return { success: true }; },
        deleteType: async id => { writes.push(id); return { success: true }; } }) },
        '@/hooks/useFieldTypeManagement': { useFieldTypeManagement: () => ({ fields: [] }) },
    });
    h.render(); let tree = h.render();
    find(tree, 'button', p => p['aria-label'] === '둘째 타입 수정').onClick(event); tree = h.render();
    assert.equal(find(tree, 'Input', p => p.value === '둘째').value, '둘째');
    await find(tree, 'Button', p => text(p.children) === '저장').onClick(); tree = h.render();
    assert.equal(find(tree, 'Button', p => text(p.children) === '저장').disabled, false);
    fail = false;
    await find(tree, 'Button', p => text(p.children) === '저장').onClick(); tree = h.render();
    assert.deepEqual(plain(writes[0]), [2, { name: '둘째', description: '설명2' }]);
    find(tree, 'button', p => p['aria-label'] === '첫째 타입 삭제').onClick(event); tree = h.render();
    await find(tree, 'Button', p => text(p.children) === '삭제').onClick();
    assert.equal(writes[1], 1);
});

for (const failure of [null, 'HTTP 실패', '네트워크 예외']) test(`UX-291 연타 요청 1회·두 버튼 잠금·해제: ${failure ?? '성공'}`, async () => {
    let request, release, calls = 0;
    const wait = new Promise(resolve => { release = resolve; });
    const h = harness('../admin/AdminUsers.tsx', {
        swr: { default: () => ({ data: { data: [
            { id: 'u1', name: '가상', email: 'a@example.test', isActive: 1, isSuperAdmin: 0 },
            { id: 'u2', name: '다른 행', email: 'b@example.test', isActive: 1, isSuperAdmin: 0 },
        ] }, mutate() {} }) },
        '@/lib/swr-fetcher': { apiRequest: async () => { calls++; await wait; if (failure) throw Error(failure); } },
        '@/components/ui/alert-dialog': { useAsyncConfirm: () => ({ confirm: next => { request = next; }, confirmationDialog: null }) },
    });
    let tree = h.render();
    find(tree, 'Button', p => p['aria-label'] === '가상 계정 정지').onClick();
    const first = request.onConfirm();
    await request.onConfirm();
    tree = h.render();
    assert.equal(calls, 1);
    const buttons = nodes(tree).filter(n => n.type === 'Button' && n.props['aria-label']?.startsWith('가상'));
    assert.ok(buttons.every(n => n.props.disabled));
    assert.match(text(find(tree, 'span', p => p.role === 'status').children), /처리 중/);
    // 공통 확인창이 열려 있는 동안 다른 행은 모달 밖이다. 직접 콜백 호출도 동일 가드로 차단한다.
    find(tree, 'Button', p => p['aria-label'] === '다른 행 계정 정지').onClick();
    await request.onConfirm(); assert.equal(calls, 1);
    release();
    if (failure) await assert.rejects(first, new RegExp(failure)); else await first;
    tree = h.render();
    assert.equal(find(tree, 'Button', p => p['aria-label'] === '가상 계정 정지').disabled, false);
    assert.equal(h.notices.filter(n => n[0] === 'success').length, failure ? 0 : 1);
});

test('UX-032 타입 생성·삭제 예외는 입력과 대화상자를 유지하고 처리 중 상태를 해제한다', async () => {
    const h = harness('./FieldTypeManagementTab.tsx', {
        '@/hooks/useFieldTypes': { useFieldTypes: () => ({ fieldTypes: [{ id: 1, name: '첫째', description: '' }],
            createType: async () => { throw Error('offline'); }, deleteType: async () => { throw Error('offline'); },
        }) },
        '@/hooks/useFieldTypeManagement': { useFieldTypeManagement: () => ({ fields: [] }) },
    });
    h.render(); let tree = h.render();
    find(tree, 'Button', p => text(p.children).includes('타입 추가')).onClick(); tree = h.render();
    find(tree, 'Input', p => p.placeholder === '예: 기업 CRM').onChange({ target: { value: '새 타입' } }); tree = h.render();
    await find(tree, 'Button', p => text(p.children) === '생성').onClick(); tree = h.render();
    assert.equal(find(tree, 'Input', p => p.value === '새 타입').value, '새 타입');
    assert.equal(find(tree, 'Button', p => text(p.children) === '생성').disabled, false);
    find(tree, 'button', p => p['aria-label'] === '첫째 타입 삭제').onClick(event); tree = h.render();
    await find(tree, 'Button', p => text(p.children) === '삭제').onClick(); tree = h.render();
    assert.equal(find(tree, 'Button', p => text(p.children) === '삭제').disabled, false);
    assert.equal(h.notices.filter(n => n[0] === 'error').length, 2);
});

test('UX-292 조직명 버튼·행 클릭은 상세 진입하고 목록 복귀에 원래 버튼 초점을 복원한다', () => {
    const focused = [], queries = [];
    const h = harness('../admin/AdminOrganizations.tsx', {
        swr: { default: key => { queries.push(key); return { data: key?.endsWith('/org1') ? { data: {
            organization: { name: '가상 조직' }, members: [], workspaces: [], subscriptions: [],
        } } : { data: [{ id: 'org1', name: '가상 조직', slug: 'test', recordCount: 0, emailCount: 0, alimtalkCount: 0 }] } }; } },
        '@/lib/swr-fetcher': {},
    }, { document: { getElementById: id => ({ focus: () => focused.push(id) }) } });
    let tree = h.render();
    find(tree, 'Button', p => p.id === 'admin-org-org1').onClick(event); tree = h.render();
    assert.ok(queries.includes('/api/admin/organizations/org1'));
    find(tree, 'Button', p => text(p.children).includes('목록으로')).onClick(); tree = h.render();
    assert.deepEqual(focused, ['admin-org-org1']);
    find(tree, 'TableRow', p => !!p.onClick).onClick(); tree = h.render();
    assert.ok(text(tree).includes('가상 조직'));
});

test('UX-036 생성된 필수 속성은 레코드 추가에서 빈 값 제출을 차단한다', async () => {
    let creates = 0;
    const h = harness('../records/CreateRecordDialog.tsx', {
        '@/hooks/useResolvedFields': { useResolvedFields: () => ({ fields: [{ key: 'company', label: '회사', fieldType: 'text', isRequired: 1 }] }) },
    });
    const props = { open: true, partitionId: 1, onOpenChange() {}, onSubmit: async () => { creates++; return { success: true }; } };
    let tree = h.render(props);
    const submit = () => find(tree, 'Button', p => p.onClick && text(p.children) === '등록').onClick();
    await submit(); tree = h.render(props);
    assert.equal(creates, 0); assert.match(text(tree), /필수 항목/);
    find(tree, 'Input').onChange({ target: { value: '가상 회사' } }); tree = h.render(props);
    await submit(); assert.equal(creates, 1);
});
