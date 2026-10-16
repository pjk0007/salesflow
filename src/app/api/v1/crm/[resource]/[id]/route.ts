import { salesHandler } from "@/lib/customer-platform/sales-http";
export const GET = salesHandler(true);
export const PATCH = salesHandler(true);
