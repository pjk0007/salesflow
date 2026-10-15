export interface SendbInboxTeam {
    id: string;
    channelId: number;
    name: string;
    description: string;
    autoAssign: boolean;
    requireAvailable: boolean;
    enabled: boolean;
    version: number;
    memberIds: string[];
    members: { id: string; name: string; eligible: boolean }[];
}
