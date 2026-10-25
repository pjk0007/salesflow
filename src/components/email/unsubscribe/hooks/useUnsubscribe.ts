"use client";

import { useState, useEffect, useCallback } from "react";
import {
    fetchUnsubscribeTarget,
    submitUnsubscribe,
    submitUnsubscribeReason,
} from "../api/unsubscribe";
import type { UnsubscribeStatus, UnsubscribeReason, ReasonStatus } from "../types";
import { unsubscribeFailureStatus } from "../utils/failure";

export function useUnsubscribe(token: string | null) {
    const [status, setStatus] = useState<UnsubscribeStatus>({ kind: "loading" });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 사유는 거부 완료 후에 받는다. 거부를 가로막는 절차가 되어선 안 된다.
    const [selectedReason, setSelectedReason] = useState<UnsubscribeReason | null>(null);
    const [reasonDetail, setReasonDetail] = useState("");
    const [reasonStatus, setReasonStatus] = useState<ReasonStatus>("idle");
    // 조회를 다시 할 때 올린다
    const [loadAttempt, setLoadAttempt] = useState(0);

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
                setStatus(unsubscribeFailureStatus(err, "load"));
            });

        return () => {
            cancelled = true;
        };
    }, [token, loadAttempt]);

    const submit = useCallback(async (email: string) => {
        if (!token) return;
        setIsSubmitting(true);
        try {
            await submitUnsubscribe(token);
            setStatus({ kind: "done", email });
        } catch (err: unknown) {
            setStatus(unsubscribeFailureStatus(err, "submit", email));
        } finally {
            setIsSubmitting(false);
        }
    }, [token]);

    const confirm = useCallback(async () => {
        if (status.kind !== "confirm" || isSubmitting) return;
        await submit(status.email);
    }, [status, isSubmitting, submit]);

    /** 일시 오류 뒤 같은 요청을 다시 한다. 제출은 서버가 이미 거부한 주소도 성공으로 답해 중복되지 않는다 */
    const retry = useCallback(async () => {
        if (status.kind !== "error" || isSubmitting) return;
        if (status.retry === "submit" && status.email) {
            await submit(status.email);
            return;
        }
        setStatus({ kind: "loading" });
        setLoadAttempt((n) => n + 1);
    }, [status, isSubmitting, submit]);

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
        retry,
        sendReason,
    };
}
