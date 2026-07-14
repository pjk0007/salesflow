"use client";

import { useState, useEffect, useCallback } from "react";
import {
    fetchUnsubscribeTarget,
    submitUnsubscribe,
    submitUnsubscribeReason,
} from "../api/unsubscribe";
import type { UnsubscribeStatus, UnsubscribeReason, ReasonStatus } from "../types";

export function useUnsubscribe(token: string | null) {
    const [status, setStatus] = useState<UnsubscribeStatus>({ kind: "loading" });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 사유는 거부 완료 후에 받는다. 거부를 가로막는 절차가 되어선 안 된다.
    const [selectedReason, setSelectedReason] = useState<UnsubscribeReason | null>(null);
    const [reasonDetail, setReasonDetail] = useState("");
    const [reasonStatus, setReasonStatus] = useState<ReasonStatus>("idle");

    useEffect(() => {
        if (!token) {
            setStatus({ kind: "invalid", message: "유효하지 않은 링크입니다." });
            return;
        }

        let cancelled = false;

        fetchUnsubscribeTarget(token)
            .then((target) => {
                if (cancelled) return;
                // 이미 거부한 주소면 확인 절차 없이 완료 화면으로 보낸다.
                setStatus(
                    target.alreadyUnsubscribed
                        ? { kind: "done", email: target.email }
                        : { kind: "confirm", email: target.email }
                );
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : "수신거부 정보를 불러오지 못했습니다.";
                setStatus({ kind: "invalid", message });
            });

        return () => {
            cancelled = true;
        };
    }, [token]);

    const confirm = useCallback(async () => {
        if (!token || status.kind !== "confirm") return;

        setIsSubmitting(true);
        try {
            await submitUnsubscribe(token);
            setStatus({ kind: "done", email: status.email });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "수신거부 처리에 실패했습니다.";
            setStatus({ kind: "invalid", message });
        } finally {
            setIsSubmitting(false);
        }
    }, [token, status]);

    const sendReason = useCallback(async () => {
        if (!token || !selectedReason) return;

        const reason =
            selectedReason === "기타" ? reasonDetail.trim() || "기타" : selectedReason;

        setReasonStatus("submitting");
        try {
            await submitUnsubscribeReason(token, reason);
        } catch {
            // 사유 전송이 실패해도 거부는 이미 완료됐다. 수신자에게 되돌릴 것은 없다.
        } finally {
            setReasonStatus("submitted");
        }
    }, [token, selectedReason, reasonDetail]);

    return {
        status,
        isSubmitting,
        selectedReason,
        setSelectedReason,
        reasonDetail,
        setReasonDetail,
        reasonStatus,
        confirm,
        sendReason,
    };
}
