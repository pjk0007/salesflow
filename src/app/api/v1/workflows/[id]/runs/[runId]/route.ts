import { workflowRunHandlers } from "@/lib/customer-workflows/routes";
export const { GET, POST } = workflowRunHandlers(true);
