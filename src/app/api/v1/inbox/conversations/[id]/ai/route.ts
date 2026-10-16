import { supportConversationHandlers } from "@/lib/customer-ai/routes";
export const maxDuration = 90;
export const { GET, POST } = supportConversationHandlers(true);
