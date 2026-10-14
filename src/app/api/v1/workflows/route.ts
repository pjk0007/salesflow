import { workflowCollectionHandlers } from "@/lib/customer-workflows/routes";
export const { GET, POST } = workflowCollectionHandlers(true);
