"use client";

import { useSession } from "@/contexts/SessionContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminOrganizations from "@/components/admin/AdminOrganizations";
import AdminUsers from "@/components/admin/AdminUsers";

export default function AdminPage() {
    const { user, isLoading } = useSession();
    const router = useRouter();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            if (!user?.isSuperAdmin) {
                router.replace("/");
            } else {
                setReady(true);
            }
        }
    }, [user, isLoading, router]);

    if (isLoading || !ready) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-40 bg-white border-b">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold">Super Admin</h1>
                        <p className="text-sm text-muted-foreground">{user?.email}</p>
                    </div>
                    <a href="/" className="text-sm text-blue-600 hover:underline">앱으로 돌아가기</a>
                </div>
            </header>
            <main className="max-w-7xl mx-auto px-6 py-8">
                <Tabs defaultValue="dashboard">
                    <TabsList>
                        <TabsTrigger value="dashboard">대시보드</TabsTrigger>
                        <TabsTrigger value="organizations">조직</TabsTrigger>
                        <TabsTrigger value="users">사용자</TabsTrigger>
                    </TabsList>
                    <TabsContent value="dashboard" className="mt-6">
                        <AdminDashboard />
                    </TabsContent>
                    <TabsContent value="organizations" className="mt-6">
                        <AdminOrganizations />
                    </TabsContent>
                    <TabsContent value="users" className="mt-6">
                        <AdminUsers />
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}
