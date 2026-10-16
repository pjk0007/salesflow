import { mailboxRelay } from "@/lib/inbox-email/routes";
export const { POST } = mailboxRelay("receive");
