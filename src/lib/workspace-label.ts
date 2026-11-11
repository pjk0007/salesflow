// 사업부(워크스페이스) 표시 이름 — 회사 넘버링 원칙: "1-디하", "2-백오피스랩" … (번호는 워크스페이스 설정의 displayNo)
export function workspaceLabel(ws: { name: string; displayNo?: string | null }): string {
    return ws.displayNo ? `${ws.displayNo}-${ws.name}` : ws.name;
}

/** 번호 순(번호 없는 사업부는 뒤로, 그 안에서는 원래 순서) */
export function sortByDisplayNo<T extends { displayNo?: string | null }>(list: T[]): T[] {
    return list
        .map((w, i) => ({ w, i }))
        .sort((a, b) => {
            const an = a.w.displayNo ? Number(a.w.displayNo) : Infinity;
            const bn = b.w.displayNo ? Number(b.w.displayNo) : Infinity;
            return an === bn ? a.i - b.i : an - bn;
        })
        .map((x) => x.w);
}
