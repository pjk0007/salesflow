export interface SendbInboxTeam {
    id: string;
    channelId: number;
    name: string;
    description: string;
    autoAssign: boolean;
    requireAvailable: boolean;
    requireBusinessHours: boolean;
    businessHours: {
        configured: boolean;
        open: boolean;
        timezone: string | null;
        nextOpenAt: string | null;
    } | null;
    enabled: boolean;
    version: number;
    memberIds: string[];
    members: { id: string; name: string; eligible: boolean }[];
}
