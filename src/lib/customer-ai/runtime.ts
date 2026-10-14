import { checkTokenQuota } from "@/lib/ai/quota";
import { callCopyProvider } from "@/lib/ai-copy/provider";
export const supportDeps = () => ({
    now: () => new Date(),
    quota: async (orgId: string) => (await checkTokenQuota(orgId)).allowed,
    call: callCopyProvider,
    timeoutMs: 25000,
});
