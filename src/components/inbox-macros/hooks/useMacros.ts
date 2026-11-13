import useSWR from "swr";
import { inboxRequest } from "@/components/inbox/api";
import type { InboxMacro } from "../types";

export const macrosUrl = (workspaceId: number) => `/api/inbox/macros?workspaceId=${workspaceId}`;
/** 사업부 매크로 목록 */
export const useMacros = (workspaceId: number | null | undefined) =>
    useSWR(workspaceId ? macrosUrl(workspaceId) : null, inboxRequest<InboxMacro[]>);
