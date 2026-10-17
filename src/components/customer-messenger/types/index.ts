import type { MessengerSettings } from "@/lib/customer-messenger/rules";
export type MessengerBrand = {
    logoUrl: string;
    iconUrl?: string;
};
export type PublicMessengerSettings = MessengerSettings & {
    aiAvailable: boolean;
    weekly: { day: number; start: string; end: string }[];
    timezone?: string;
};
