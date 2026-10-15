"use client";
import { useLayoutEffect, useMemo } from "react";
import { StaffDraftSession } from "./staff-draft-session";

export type SubscribeSessionInvalidation = (listener: () => void) => () => void;
export function useStaffDraftSession(
    scope: string,
    allowed: boolean,
    subscribeInvalidation?: SubscribeSessionInvalidation,
) {
    const session = useMemo(() => new StaffDraftSession(scope, allowed), [scope, allowed]);
    useLayoutEffect(() => {
        if (allowed) session.activate();
        else session.invalidate();
        const unsubscribe = subscribeInvalidation?.(() => session.invalidate());
        return () => {
            unsubscribe?.();
            session.invalidate();
        };
    }, [session, allowed, subscribeInvalidation]);
    return session;
}
