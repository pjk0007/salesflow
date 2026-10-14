import { NextRequest } from "next/server";
import { salesHandler } from "@/lib/customer-platform/sales-http";
import type { CustomerResource } from "./rules";
export function customerRecordHandlers(resource: CustomerResource) {
    const handler = (
        req: NextRequest,
        context: { params: Promise<{ id: string }> },
    ) =>
        salesHandler(true)(req, {
            params: context.params.then((p) => ({ ...p, resource })),
        });
    return { GET: handler, POST: handler, PATCH: handler };
}
