import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { TabPrefs, UserPreferences } from "@/lib/db/schema";

type PrefsResponse = { success: boolean; data: UserPreferences };

/** 내 사업부 탭 설정 (화면 key별) — 순서·숨긴 탭·꺼낸 탭. 바꾸면 화면에 먼저 보이고 저장한다 */
export function useTabPrefs(tabKey: string | undefined) {
    const { data, mutate } = useSWR<PrefsResponse>(tabKey ? "/api/auth/preferences" : null, defaultFetcher);
    const prefs: TabPrefs = (tabKey && data?.data?.tabs?.[tabKey]) || {};

    const save = async (patch: TabPrefs) => {
        if (!tabKey) return { success: false };
        const optimistic = (cur: PrefsResponse | undefined): PrefsResponse => {
            const tabs = cur?.data?.tabs ?? {};
            return { success: true, data: { ...cur?.data, tabs: { ...tabs, [tabKey]: { ...tabs[tabKey], ...patch } } } };
        };
        await mutate(optimistic, { revalidate: false });
        const res = await fetch("/api/auth/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabKey, ...patch }),
        }).catch(() => null);
        const result = (await res?.json().catch(() => null)) ?? { success: false };
        await mutate();
        return result as { success: boolean; error?: string };
    };

    return { prefs, loaded: !tabKey || data !== undefined, save };
}

/** 저장한 순서대로 앞에 두고, 저장에 없는 탭(새 사업부)은 기본 순서대로 뒤에 붙인다 */
export function applyOrder<T extends { id: number }>(items: T[], order: number[] | null | undefined): T[] {
    if (!order?.length) return items;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...items].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}
