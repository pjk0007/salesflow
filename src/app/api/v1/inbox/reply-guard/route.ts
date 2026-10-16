import { replyGuardHandlers } from "@/lib/inbox-reply-guard/routes";
export const { GET, PATCH, POST } = replyGuardHandlers(true);
