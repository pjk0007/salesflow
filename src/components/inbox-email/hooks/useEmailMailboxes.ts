import useSWR from "swr";
import { emailRequest } from "../api";
import type { EmailMailbox } from "../types";
export const useEmailMailboxes = (workspaceId: number | null) =>
    useSWR(
        workspaceId ? `/api/email-mailboxes?workspaceId=${workspaceId}` : null,
        emailRequest<EmailMailbox[]>,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
