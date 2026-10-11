import type { SenderProfile } from "../types/sender-profile";

export function getSenderProfilePage(profiles: SenderProfile[], query: string, requestedPage: number) {
    const keyword = query.trim().toLowerCase();
    const filtered = profiles.filter((profile) =>
        [profile.name, profile.fromName, profile.fromEmail].some((value) => value.toLowerCase().includes(keyword))
    ).sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / 8));
    const page = Math.max(1, Math.min(requestedPage, totalPages));
    return { items: filtered.slice((page - 1) * 8, page * 8), total, totalPages, page };
}
