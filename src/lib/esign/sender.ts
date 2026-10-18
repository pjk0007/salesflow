import { pickSender, type LegacyEmailConfig, type ResolvedSender, type SenderCandidate } from "../email-sender-pick";

/** An explicit contract sender must belong to the organization; never fall back to another brand. */
export function selectEsignEmailSender(address: string | undefined, profiles: readonly SenderCandidate[], config: LegacyEmailConfig | null): ResolvedSender {
    const requested = address?.trim().toLowerCase();
    if (!requested) return pickSender({ preferredIds: [], candidates: profiles, config });
    const profile = profiles.find(candidate => candidate.fromEmail.trim().toLowerCase() === requested);
    if (profile) return pickSender({ preferredIds: [profile.id], candidates: profiles, config });
    if (config?.fromEmail?.trim().toLowerCase() === requested)
        return { fromEmail: config.fromEmail, fromName: config.fromName || undefined, profileId: null };
    return { fromEmail: null, profileId: null };
}
