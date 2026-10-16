import type { SendbInboxPresence } from "./presence-types";
export interface SendbInboxCapacity {
    agents: (SendbInboxPresence["agents"][number] & { version: number })[];
    workerEnabled: boolean;
}
export interface SendbInboxDispatch {
    examined: number;
    assigned: number;
    waiting: number;
}
