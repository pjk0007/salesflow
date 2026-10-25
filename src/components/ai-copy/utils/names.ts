// 발송 연결·변경 이력에서 번호 대신 이름을 보여 주는 이름 찾기(UX-242·305).
// 화면이 이미 받은 목록에서만 찾고, 없으면(삭제됨·다른 쪽 버전) 번호를 그대로 표시한다.

interface Named {
    id: number;
    name: string | null;
}

export interface CopyNameSources {
    workspaces: Named[];
    rules: Named[];
    policies: Named[];
    knowledge: Named[];
}

const label = (list: Named[], id: number, fallback: string) => {
    const name = list.find((item) => item.id === id)?.name;
    return name ? `${name} · #${id}` : `${fallback} #${id}`;
};

export function copyNames(sources: CopyNameSources) {
    return {
        workspace: (id: number) =>
            sources.workspaces.find((w) => w.id === id)?.name ?? `사업 #${id}`,
        /** rule_id 0은 방문 감사처럼 규칙이 없는 연결이다. */
        rule: (id: number) => (id > 0 ? label(sources.rules, id, "규칙") : null),
        policy: (id: number) => label(sources.policies, id, "작성"),
        knowledge: (id: number) => label(sources.knowledge, id, "지식"),
    };
}
