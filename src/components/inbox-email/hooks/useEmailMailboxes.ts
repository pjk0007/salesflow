import useSWR from "swr";
import { emailRequest } from "../api";
import type { EmailMailbox } from "../types";
export const useEmailMailboxes = (workspaceId: number) =>
    useSWR(
        `/api/email-mailboxes?workspaceId=${workspaceId}`,
        emailRequest<EmailMailbox[]>,
    );
