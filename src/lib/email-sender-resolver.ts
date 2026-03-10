import { db, emailSenderProfiles, emailSignatures } from "@/lib/db";
import { eq, and } from "drizzle-orm";

interface FallbackConfig {
    fromEmail?: string | null;
    fromName?: string | null;
    signatureEnabled?: boolean | null;
    signature?: string | null;
}

/** 기본 발신자 프로필 조회 (emailConfigs fallback 포함) */
export async function resolveDefaultSender(
    orgId: string,
    fallbackConfig?: FallbackConfig | null
): Promise<{ fromEmail: string | null; fromName?: string }> {
    const [defaultProfile] = await db
        .select()
        .from(emailSenderProfiles)
        .where(and(eq(emailSenderProfiles.orgId, orgId), eq(emailSenderProfiles.isDefault, true)))
        .limit(1);

    if (defaultProfile) {
        return { fromEmail: defaultProfile.fromEmail, fromName: defaultProfile.fromName };
    }
    if (fallbackConfig?.fromEmail) {
        return { fromEmail: fallbackConfig.fromEmail, fromName: fallbackConfig.fromName || undefined };
    }
    return { fromEmail: null };
}

/** 기본 서명 조회 (emailConfigs fallback 포함) */
export async function resolveDefaultSignature(
    orgId: string,
    fallbackConfig?: FallbackConfig | null
): Promise<string | null> {
    const [defaultSig] = await db
        .select()
        .from(emailSignatures)
        .where(and(eq(emailSignatures.orgId, orgId), eq(emailSignatures.isDefault, true)))
        .limit(1);

    if (defaultSig) return defaultSig.signature;
    if (fallbackConfig?.signatureEnabled && fallbackConfig?.signature) return fallbackConfig.signature;
    return null;
}
