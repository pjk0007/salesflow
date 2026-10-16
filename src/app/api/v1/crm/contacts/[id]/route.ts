import { customerRecordHandlers } from "@/lib/customer-records/http";
export const { GET, POST, PATCH } = customerRecordHandlers("contacts");
