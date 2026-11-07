import type {
    CardReason,
    CareStatus,
    Tier,
    Draft,
} from "@/lib/relationship-care/rules";
export type { CardReason, CareStatus, Tier, Draft };
export interface GreetingCard {
    contactId: string;
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    title: string | null;
    tier: Tier;
    tierLabel: string;
    version: number;
    ownerUserId: string | null;
    ownerName: string | null;
    status: CareStatus;
    statusLabel: string;
    reason: CardReason;
    reasonLabel: string;
    memoryNote: string;
    metPlace: string | null;
    lastTouchAt: string | null;
    daysSinceTouch: number | null;
    nextDueAt: string;
    welcomeDeadline: string | null;
    draft: Draft;
}
export interface TodayData {
    cards: GreetingCard[];
    counts: {
        managed: number;
        overdue: number;
        welcome: number;
        candidates: number;
        carriedOver: number;
        deferredByMarketing: number;
    };
}
export interface Care {
    contactId: string;
    version: number;
    tier: Tier;
    tierLabel: string;
    cadence: number;
    cadenceDays: number | null;
    ownerUserId: string | null;
    metPlace: string | null;
    metOn: string | null;
    memoryNote: string;
    importantDates: { label: string; monthDay: string }[];
    lastTouchAt: string | null;
    nextDueAt: string;
    snoozedUntil: string | null;
    status: CareStatus;
    statusLabel: string;
    welcomeDeadline: string | null;
    daysSinceTouch: number | null;
}
export type CareAction = "sent" | "logged" | "snooze" | "skip" | "reply";
export type Channel = "email" | "sms" | "kakao" | "call" | "meeting" | "other";
export interface ScannedCard {
    name: string | null;
    companyName: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
}
export type RegisterResult =
    | { status: "created"; contactId: string; care: Care }
    | {
          status: "duplicate";
          duplicates: { id: string; name: string; email: string | null; phone: string | null }[];
      };
