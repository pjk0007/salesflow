import type { Contact, Company } from "@/components/customer-crm/types";
import type {
    SendbCustomerDetail,
    SendbCustomerHistory,
} from "../../../../sdk/server";
export type CustomerRecord = Contact | Company;
export type CustomerDetail = SendbCustomerDetail<CustomerRecord>;
export type CustomerHistory = SendbCustomerHistory;
export type AttributeType = "text" | "number" | "boolean" | "json" | "null";
export interface AttributeRow {
    id: string;
    key: string;
    type: AttributeType;
    value: string;
}
