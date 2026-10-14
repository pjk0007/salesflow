import { workflowItemHandlers } from "@/lib/customer-workflows/routes";
export const { GET, PATCH, POST } = workflowItemHandlers(true);
