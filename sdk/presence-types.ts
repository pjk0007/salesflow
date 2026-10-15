export interface SendbInboxPresence {
    agents: {
        id: string;
        name: string;
        canRespond: boolean;
        online: boolean;
        state: "available" | "away";
        activity: "viewing" | "reply" | "note" | null;
    }[];
    me: { state: "available" | "away"; version: number };
    serverTime: string;
}
