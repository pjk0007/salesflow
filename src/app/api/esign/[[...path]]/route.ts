import { handleEsignRequest } from "@/lib/esign/http";
import { esignHttpDependencies } from "@/lib/esign/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = (request: Request) => handleEsignRequest(request, esignHttpDependencies);
export { handler as GET, handler as POST, handler as PATCH };
