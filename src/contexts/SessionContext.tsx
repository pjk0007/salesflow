"use client";

import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    useRef,
    type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { OrgRole } from "@/types";
import { SessionTransitionQueue } from "@/components/inbox/hooks/session-transition-queue";

interface SessionOrg {
    id: string;
    name: string;
    slug: string;
    role: OrgRole;
}

interface SessionUser {
    id: string;
    orgId: string;
    name: string;
    email: string;
    role: OrgRole;
    isSuperAdmin: boolean;
    onboardingCompleted: boolean;
    organizations: SessionOrg[];
}

interface SessionContextType {
    user: SessionUser | null;
    isLoading: boolean;
    logout: () => void;
    refreshSession: () => Promise<void>;
    switchOrg: (orgId: string) => Promise<void>;
    createOrg: (name: string) => Promise<{ success: boolean; error?: string }>;
    isSessionChanging: boolean;
    sessionEpoch: number;
    subscribeInvalidation: (listener: () => void) => () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [user, setUser] = useState<SessionUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSessionChanging, setIsSessionChanging] = useState(false);
    const sessionChanging = useRef(false);
    const [sessionEpoch, setSessionEpoch] = useState(0);
    const identity = useRef<string | null>(null);
    const sessionRequest = useRef(0);
    const invalidationListeners = useRef(new Set<() => void>());
    const subscribeInvalidation = useCallback((listener: () => void) => {
        invalidationListeners.current.add(listener);
        return () => { invalidationListeners.current.delete(listener); };
    }, []);
    const invalidate = useCallback(() => {
        // Run before the request can replace cookies; pending inbox writes stop here.
        sessionRequest.current++;
        for (const listener of invalidationListeners.current) listener();
        setSessionEpoch((value) => value + 1);
    }, []);
    const [transitions] = useState(() => new SessionTransitionQueue(
        () => { sessionChanging.current = true; invalidate(); setIsSessionChanging(true); },
        () => { sessionChanging.current = false; setIsSessionChanging(false); },
    ));

    const fetchSession = useCallback(async (reconciling = false) => {
        // Ordinary refreshes cannot supersede the queued transition's final identity check.
        if (sessionChanging.current && reconciling !== true) return;
        const request = ++sessionRequest.current;
        try {
            const res = await fetch("/api/auth/me");
            const data = await res.json();
            if (request !== sessionRequest.current) return;

            if (data.success) {
                const nextIdentity = `${data.user.orgId}:${data.user.userId}`;
                if (identity.current && identity.current !== nextIdentity) invalidate();
                identity.current = nextIdentity;
                setUser({
                    id: data.user.userId,
                    orgId: data.user.orgId,
                    name: data.user.name,
                    email: data.user.email,
                    role: data.user.role,
                    isSuperAdmin: data.user.isSuperAdmin === true,
                    onboardingCompleted: data.user.onboardingCompleted ?? false,
                    organizations: data.user.organizations?.map((o: { organizationId: string; orgName: string; orgSlug: string; role: string }) => ({
                        id: o.organizationId,
                        name: o.orgName,
                        slug: o.orgSlug ?? "",
                        role: o.role as OrgRole,
                    })) ?? [],
                });
            } else {
                if (identity.current) invalidate();
                identity.current = null;
                setUser(null);
            }
        } catch {
            if (request !== sessionRequest.current) return;
            if (identity.current) invalidate();
            identity.current = null;
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    }, [invalidate]);

    const logout = useCallback(() => transitions.run(async (isLatest) => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch (error) {
            console.error("Logout error:", error);
        } finally {
            // An uncertain response may still have changed the cookie.
            await fetchSession(true);
        }
        if (isLatest() && !identity.current) router.push("/login");
    }), [fetchSession, router, transitions]);

    const switchOrg = useCallback((orgId: string) => transitions.run(async (isLatest) => {
        let switched = false;
        try {
            const res = await fetch("/api/org/switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId }),
            });
            const data = await res.json();
            switched = data.success === true;
        } catch (error) {
            console.error("Org switch error:", error);
        } finally {
            // Also reconcile intermediate successes and failed/ambiguous cookie responses.
            await fetchSession(true);
        }
        if (switched && isLatest() && identity.current) router.push("/");
    }), [fetchSession, router, transitions]);

    const createOrg = useCallback(async (name: string) => {
        let result: { success: boolean; error?: string } = { success: false, error: "서버 오류가 발생했습니다." };
        await transitions.run(async (isLatest) => {
            try {
                const res = await fetch("/api/org/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name.trim() }),
                });
                const data = await res.json();
                result = { success: data.success === true, error: data.error || "조직 생성에 실패했습니다." };
            } catch {
                // Reconcile even if Set-Cookie arrived with an unreadable response body.
            } finally {
                await fetchSession(true);
            }
            if (result.success && isLatest() && identity.current) router.push("/");
        });
        return result;
    }, [fetchSession, router, transitions]);

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    return (
        <SessionContext.Provider
            value={{
                user,
                isLoading,
                logout,
                refreshSession: fetchSession,
                switchOrg,
                createOrg,
                isSessionChanging,
                sessionEpoch,
                subscribeInvalidation,
            }}
        >
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
