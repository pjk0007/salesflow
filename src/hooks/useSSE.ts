import { useEffect, useRef, useState, useCallback } from "react";
import type { RecordEventData } from "@/lib/sse";

interface UseSSEOptions {
    partitionId: number | null;
    enabled?: boolean;
    onRecordCreated?: (data: RecordEventData) => void;
    onRecordUpdated?: (data: RecordEventData) => void;
    onRecordDeleted?: (data: RecordEventData) => void;
    onBulkDeleted?: (data: RecordEventData) => void;
    onAnyChange?: () => void;
}

export function useSSE({
    partitionId,
    enabled = true,
    onRecordCreated,
    onRecordUpdated,
    onRecordDeleted,
    onBulkDeleted,
    onAnyChange,
}: UseSSEOptions) {
    const [isConnected, setIsConnected] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const sessionIdRef = useRef(
        typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    );
    const attemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 콜백을 ref로 관리 — 재연결 방지
    const callbacksRef = useRef({
        onRecordCreated,
        onRecordUpdated,
        onRecordDeleted,
        onBulkDeleted,
        onAnyChange,
    });
    callbacksRef.current = {
        onRecordCreated,
        onRecordUpdated,
        onRecordDeleted,
        onBulkDeleted,
        onAnyChange,
    };

    const connect = useCallback(() => {
        if (!partitionId || !enabled) return;

        // 기존 연결 정리
        if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
        }

        const url = `/api/sse?partitionId=${partitionId}&sessionId=${sessionIdRef.current}`;
        const es = new EventSource(url, { withCredentials: true });
        esRef.current = es;

        es.addEventListener("connected", () => {
            setIsConnected(true);
            attemptRef.current = 0;
        });

        const handleEvent = (event: MessageEvent, type: string) => {
            try {
                const data = JSON.parse(event.data);
                const cbs = callbacksRef.current;
                switch (type) {
                    case "record:created":
                        cbs.onRecordCreated?.(data);
                        break;
                    case "record:updated":
                        cbs.onRecordUpdated?.(data);
                        break;
                    case "record:deleted":
                        cbs.onRecordDeleted?.(data);
                        break;
                    case "record:bulk-deleted":
                        cbs.onBulkDeleted?.(data);
                        break;
                }
                cbs.onAnyChange?.();
            } catch {
                // 파싱 실패 무시
            }
        };

        es.addEventListener("record:created", (e) => handleEvent(e, "record:created"));
        es.addEventListener("record:updated", (e) => handleEvent(e, "record:updated"));
        es.addEventListener("record:deleted", (e) => handleEvent(e, "record:deleted"));
        es.addEventListener("record:bulk-deleted", (e) => handleEvent(e, "record:bulk-deleted"));

        es.onerror = () => {
            setIsConnected(false);
            es.close();
            esRef.current = null;

            // 지수 백오프 재연결 (최대 5회)
            if (attemptRef.current < 5) {
                const delay = Math.min(1000 * Math.pow(2, attemptRef.current), 30000);
                attemptRef.current++;
                reconnectTimerRef.current = setTimeout(connect, delay);
            }
        };
    }, [partitionId, enabled]);

    useEffect(() => {
        connect();

        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (esRef.current) {
                esRef.current.close();
                esRef.current = null;
            }
            setIsConnected(false);
        };
    }, [connect]);

    const reconnect = useCallback(() => {
        attemptRef.current = 0;
        connect();
    }, [connect]);

    return { isConnected, sessionId: sessionIdRef.current, reconnect };
}
