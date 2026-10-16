import { importFileHandlers } from "@/lib/customer-import-files/routes";
export const { GET, POST } = importFileHandlers(true);
