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
    // 연결 오류가 난 뒤 아직 다시 연결되지 않은 상태. 첫 연결 중에는 false라 화면 안내가 깜빡이지 않는다.
    const [hasError, setHasError] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const sessionIdRef = useRef(
        typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    );
    const attemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 한 번이라도 연결된 뒤 다시 연결되면 끊긴 동안의 변경을 놓쳤을 수 있다.
    const connectedOnceRef = useRef(false);

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
            setHasError(false);
            attemptRef.current = 0;
            if (connectedOnceRef.current) callbacksRef.current.onAnyChange?.();
            connectedOnceRef.current = true;
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
            setHasError(true);
            es.close();
            esRef.current = null;

            // 지수 백오프 재연결 (최대 5회)
            if (attemptRef.current < 5) {
                const delay = Math.min(1000 * Math.pow(2, attemptRef.current), 30000);
                attemptRef.current++;
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectTimerRef.current = null;
                    connect();
                }, delay);
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
            setHasError(false);
        };
    }, [connect]);

    const reconnect = useCallback(() => {
        // 예약된 자동 재시도가 있으면 지우고 바로 연결한다(이중 연결 방지).
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        attemptRef.current = 0;
        connect();
    }, [connect]);

    // 재연결 5회가 모두 실패해 멈춘 뒤에는 네트워크 복구·탭 복귀 때 다시 연결한다.
    useEffect(() => {
        if (!partitionId || !enabled) return;
        const resume = () => {
            if (document.visibilityState !== "visible") return;
            if (esRef.current || reconnectTimerRef.current) return;
            reconnect();
        };
        window.addEventListener("online", resume);
        document.addEventListener("visibilitychange", resume);
        return () => {
            window.removeEventListener("online", resume);
            document.removeEventListener("visibilitychange", resume);
        };
    }, [partitionId, enabled, reconnect]);

    return { isConnected, disconnected: hasError && !isConnected, sessionId: sessionIdRef.current, reconnect };
}
