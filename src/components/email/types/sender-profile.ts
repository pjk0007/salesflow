export interface SenderProfile {
    id: number;
    name: string;
    fromName: string;
    fromEmail: string;
    isDefault: boolean;
}

export interface SenderProfileManagerProps {
    profiles: SenderProfile[];
    createProfile: (data: { name: string; fromName: string; fromEmail: string }) => Promise<{ success: boolean; error?: string }>;
    updateProfile: (id: number, data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
    deleteProfile: (id: number) => Promise<{ success: boolean; error?: string }>;
}
