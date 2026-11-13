import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";

/** 내가 이 대화방을 팔로우하는지, 팔로우/그만두기 */
export function useFollow(conversationId: string | null) {
    const url = conversationId ? `/api/inbox/conversations/${conversationId}/follow` : null;
    const swr = useSWR(url, inboxRequest<{ following: boolean }>);
    const set = async (follow: boolean) => {
        if (!url) return;
        const data = await inboxRequest<{ following: boolean }>(url, { method: follow ? "POST" : "DELETE" });
        await swr.mutate(data, { revalidate: false });
    };
    return { following: !!swr.data?.following, loading: !swr.data && !swr.error, set };
}
