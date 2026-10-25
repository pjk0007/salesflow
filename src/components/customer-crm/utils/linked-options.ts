/** 선택기에 넘길 알려진 고객·회사 목록. 불러온 목록 항목이 있으면 그대로 쓰고(보관 정보 유지), 없을 때만 딜·할 일에 저장된 연결 이름으로 채운다(UX-088). */
export type LinkedOption = { id: string; name: string; archivedAt?: string | null };
export function linkedOptions<T extends LinkedOption>(
    list: T[],
    linked: { id?: string | null; name?: string | null; archivedAt?: string | null },
): LinkedOption[] {
    if (!linked.id || !linked.name || list.some((o) => o.id === linked.id))
        return list;
    return [
        ...list,
        { id: linked.id, name: linked.name, archivedAt: linked.archivedAt ?? null },
    ];
}
