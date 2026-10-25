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
import { fetchSessionResponse } from "@/lib/session-request";
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
    sessionError: string | null;
    logout: () => void;
    refreshSession: () => Promise<void>;
    switchOrg: (orgId: string) => Promise<{ success: boolean; error?: string }>;
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
    const [sessionError, setSessionError] = useState<string | null>(null);
    const [isSessionChanging, setIsSessionChanging] = useState(false);
    const sessionChanging = useRef(false);
    const [sessionEpoch, setSessionEpoch] = useState(0);
    const identity = useRef<string | null>(null);
    // 세션 조회가 실패해 user를 숨겨도 기존 SWR 캐시의 소유 조직은 잊지 않는다.
    const cacheIdentity = useRef<string | null>(null);
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
        let request = ++sessionRequest.current;
        if (!identity.current) setIsLoading(true);
        setSessionError(null);
        try {
            const data = await fetchSessionResponse();
            if (request !== sessionRequest.current) return;

            if (data.success) {
                const nextIdentity = `${data.user.orgId}:${data.user.userId}`;
                if (cacheIdentity.current && cacheIdentity.current !== nextIdentity) {
                    // 조직이 바뀌면 SWR 전역 캐시와 페이지 자체 상태를 함께 비운다.
                    // 여러 소비자가 전역 mutate를 사용하므로 일부 화면만 새 provider로 감싸지 않는다.
                    invalidate();
                    identity.current = null;
                    setUser(null);
                    setIsLoading(true);
                    window.location.replace("/");
                    return;
                }
                identity.current = nextIdentity;
                cacheIdentity.current = nextIdentity;
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
                if (identity.current) { invalidate(); request = sessionRequest.current; }
                identity.current = null;
                setUser(null);
            }
        } catch {
            if (request !== sessionRequest.current) return;
            // Hide stale account data after an ambiguous cookie transition, but keep
            // the cookie so retry can recover without redirecting to login.
            if (identity.current) { invalidate(); request = sessionRequest.current; }
            identity.current = null;
            setUser(null);
            setSessionError("로그인 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } finally {
            if (request === sessionRequest.current) setIsLoading(false);
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

    const switchOrg = useCallback(async (orgId: string) => {
        let result = { success: false, error: "조직을 전환하지 못했습니다. 다시 시도해주세요." };
        await transitions.run(async (isLatest) => {
        try {
            const res = await fetch("/api/org/switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId }),
            });
            const data = await res.json();
            result = { success: res.ok && data.success === true, error: data.error || "조직을 전환하지 못했습니다." };
        } catch (error) {
            console.error("Org switch error:", error);
        } finally {
            // Also reconcile intermediate successes and failed/ambiguous cookie responses.
            await fetchSession(true);
        }
        if (result.success && isLatest() && identity.current) router.push("/");
        });
        return result;
    }, [fetchSession, router, transitions]);

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
                sessionError,
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
