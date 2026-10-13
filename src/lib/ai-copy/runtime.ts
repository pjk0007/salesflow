import { queryClient } from "../db";
import { checkTokenQuota } from "../ai/quota";
import { recordAttemptUsage, type GenerationDeps } from "./generation";
import { callCopyProvider } from "./provider";
import { attachCopyToSend, prepareCopy, type CopyPreparationInput } from "./preparation";

export const generationDeps = (): GenerationDeps => ({
    now: () => new Date(),
    quota: async (orgId) => (await checkTokenQuota(orgId)).allowed,
    call: callCopyProvider,
    late: async (attemptId, response) => {
        const conn = await queryClient.reserve();
        try {
            await recordAttemptUsage(conn, attemptId, response, true);
        } finally {
            conn.release();
        }
    },
});
export async function prepareManagedEmail(input: CopyPreparationInput) {
    const conn = await queryClient.reserve();
    try {
        return await prepareCopy(conn, input, generationDeps());
    } finally {
        conn.release();
    }
}
export async function attachManagedEmail(input: { orgId: string; jobId: number; logId: number }) {
    const conn = await queryClient.reserve();
    try {
        return await attachCopyToSend(conn, input);
    } finally {
        conn.release();
    }
}
