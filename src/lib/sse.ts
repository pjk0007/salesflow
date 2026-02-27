import type { ServerResponse } from "http";

export type RecordEventType =
    | "record:created"
    | "record:updated"
    | "record:deleted"
    | "record:bulk-deleted";

export interface RecordEventData {
    partitionId: number;
    recordId?: number;
    recordIds?: number[];
}

interface SSEClient {
    res: ServerResponse;
    sessionId: string;
}

// dev 모드에서 HMR로 인한 재생성 방지를 위해 globalThis 사용
const globalClients =
    (globalThis as any).__sseClients ??
    ((globalThis as any).__sseClients = new Map<string, Set<SSEClient>>());

const clients: Map<string, Set<SSEClient>> = globalClients;

export function addClient(partitionId: string, client: SSEClient): void {
    if (!clients.has(partitionId)) {
        clients.set(partitionId, new Set());
    }
    clients.get(partitionId)!.add(client);
}

export function removeClient(partitionId: string, client: SSEClient): void {
    const set = clients.get(partitionId);
    if (set) {
        set.delete(client);
        if (set.size === 0) clients.delete(partitionId);
    }
}

export function broadcastToPartition(
    partitionId: number,
    event: RecordEventType,
    data: RecordEventData,
    senderSessionId?: string
): void {
    const key = String(partitionId);
    const set = clients.get(key);
    if (!set || set.size === 0) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of set) {
        // 자기 자신에게는 전송하지 않음
        if (senderSessionId && client.sessionId === senderSessionId) continue;
        try {
            client.res.write(payload);
        } catch {
            set.delete(client);
        }
    }
}

export function sendHeartbeat(partitionId: string, client: SSEClient): boolean {
    try {
        client.res.write(": heartbeat\n\n");
        return true;
    } catch {
        removeClient(partitionId, client);
        return false;
    }
}
