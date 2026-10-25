"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { addUnsubscribe, getUnsubscribes, lookupUnsubscribes } from "../api/unsubscribes";
import type { UnsubscribeLookupResult } from "../types";

export function useUnsubscribeManagement(orgId: string, sessionEpoch: number) {
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [lookupResults, setLookupResults] = useState<UnsubscribeLookupResult[] | null>(null);
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [addedEmail, setAddedEmail] = useState<string | null>(null);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const query = new URLSearchParams({ page: String(page), pageSize: "20", q: search });
    const { data, error, isLoading, mutate } = useSWR(
        [`/api/email/unsubscribes?${query}`, orgId, sessionEpoch],
        ([url, organization]) => getUnsubscribes(url, organization),
    );

    async function lookup(text: string) {
        const targets = text.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
        if (!targets.length || targets.length > 50) { setLookupError("이메일 또는 도메인을 1~50개 입력해주세요."); return; }
        setIsLookingUp(true);
        setLookupError(null);
        setLookupResults(null);
        try {
            const results = await lookupUnsubscribes(orgId, targets);
            if (alive.current) setLookupResults(results);
        } catch (error) {
            if (alive.current) setLookupError(error instanceof Error ? error.message : "조회에 실패했습니다.");
        } finally {
            if (alive.current) setIsLookingUp(false);
        }
    }

    /** 등록 결과 — 실패면 화면 확인창이 그 이유를 그대로 보인다 (UX-234) */
    async function add(email: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
        setIsAdding(true);
        setAddError(null);
        setAddedEmail(null);
        try {
            const result = await addUnsubscribe(orgId, email, reason);
            if (!alive.current) return { ok: true };
            setAddedEmail(result.email);
            setLookupResults(null);
            await mutate();
            return { ok: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : "등록에 실패했습니다.";
            if (alive.current) setAddError(message);
            return { ok: false, error: message };
        } finally {
            if (alive.current) setIsAdding(false);
        }
    }

    return {
        data, error, isLoading, page, setPage, search,
        searchFor: (q: string) => { setSearch(q); setPage(1); },
        refresh: () => mutate(), lookup, lookupResults, lookupError, isLookingUp,
        add, isAdding, addError, addedEmail,
    };
}
