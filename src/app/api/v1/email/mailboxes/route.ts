import { mailboxCollection } from "@/lib/inbox-email/routes";
export const { GET, POST } = mailboxCollection(true);
