"use client";

import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { OrgRole } from "@/types";

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
    onboardingCompleted: boolean;
    organizations: SessionOrg[];
}

interface SessionContextType {
    user: SessionUser | null;
    isLoading: boolean;
    logout: () => void;
    refreshSession: () => Promise<void>;
    switchOrg: (orgId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const [user, setUser] = useState<SessionUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const logout = useCallback(async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        setUser(null);
        router.push("/login");
    }, [router]);

    const fetchSession = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/me");
            const data = await res.json();

            if (data.success) {
                setUser({
                    id: data.user.userId,
                    orgId: data.user.orgId,
                    name: data.user.name,
                    email: data.user.email,
                    role: data.user.role,
                    onboardingCompleted: data.user.onboardingCompleted ?? false,
                    organizations: data.user.organizations?.map((o: { organizationId: string; orgName: string; orgSlug: string; role: string }) => ({
                        id: o.organizationId,
                        name: o.orgName,
                        slug: o.orgSlug ?? "",
                        role: o.role as OrgRole,
                    })) ?? [],
                });
            } else {
                setUser(null);
            }
        } catch {
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const switchOrg = useCallback(async (orgId: string) => {
        try {
            const res = await fetch("/api/org/switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orgId }),
            });
            const data = await res.json();
            if (data.success) {
                await fetchSession();
                router.push("/");
            }
        } catch (error) {
            console.error("Org switch error:", error);
        }
    }, [fetchSession, router]);

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
