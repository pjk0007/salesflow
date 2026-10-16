import useSWRInfinite from "swr/infinite";
import { workflowRequest } from "../api";
export function useWorkflowPages<T extends { id: string }>(
    url: string | null,
    refresh = 0,
) {
    return useSWRInfinite<{ rows: T[]; hasMore: boolean }>(
        (index, previous) =>
            !url || (previous && !previous.hasMore)
                ? null
                : url +
                  (index
                      ? `${url.includes("?") ? "&" : "?"}before=${previous!.rows.at(-1)!.id}`
                      : ""),
        workflowRequest,
        { refreshInterval: refresh, refreshWhenHidden: false },
    );
}
