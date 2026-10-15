import type { CustomerConversationAccess } from "../types";

/** Either public flag is sufficient; inconsistent replies must stay read-only. */
export function isReadOnlyCustomerConversation(
    value: CustomerConversationAccess | null | undefined,
) {
    return value?.historyOnly === true || value?.readOnly === true;
}

export function customerConversationTimestamp(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleString("ko-KR", {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
          });
}
