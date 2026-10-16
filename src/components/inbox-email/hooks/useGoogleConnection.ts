import useSWR from "swr";
import { emailRequest } from "../api";
import type { GoogleConnectionStatus } from "../types";
export const useGoogleConnection = (mailboxId: string) =>
    useSWR(
        `/api/email-mailboxes/${mailboxId}/google`,
        emailRequest<GoogleConnectionStatus>,
        { refreshInterval: 10000 },
    );
