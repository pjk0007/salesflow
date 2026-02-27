import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import type { DashboardWidget, Dashboard } from "@/lib/db";

const DashboardGrid = dynamic(
    () => import("@/components/dashboard/DashboardGrid"),
    { ssr: false }
);

export default function PublicDashboardPage() {
    const router = useRouter();
    const slug = router.query.slug as string;

    const [dashboard, setDashboard] = useState<Dashboard | null>(null);
    const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
    const [widgetData, setWidgetData] = useState<Record<number, unknown>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!slug) return;

        async function load() {
            try {
                const res = await fetch(`/api/public/dashboards/${slug}`);
                const json = await res.json();
                if (json.success) {
                    setDashboard(json.data);
                    setWidgets(json.data.widgets ?? []);
                } else {
                    setError("대시보드를 찾을 수 없습니다.");
                }
            } catch {
                setError("대시보드를 불러올 수 없습니다.");
            } finally {
                setLoading(false);
            }
        }

        load();
    }, [slug]);

    // 데이터 주기적 갱신
    useEffect(() => {
        if (!dashboard) return;

        async function fetchData() {
            try {
                const res = await fetch(`/api/dashboards/${dashboard!.id}/data`);
                const json = await res.json();
                if (json.success) {
                    setWidgetData(json.data);
                }
            } catch {
                // ignore
            }
        }

        fetchData();
        const interval = setInterval(fetchData, (dashboard.refreshInterval || 60) * 1000);
        return () => clearInterval(interval);
    }, [dashboard]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
            </div>
        );
    }

    if (error || !dashboard) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-xl font-bold">{error || "대시보드를 찾을 수 없습니다."}</h1>
                </div>
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{dashboard.name}</title>
            </Head>
            <div className="min-h-screen bg-gray-50 p-6">
                <div className="max-w-7xl mx-auto">
                    <h1 className="text-2xl font-bold mb-4">{dashboard.name}</h1>
                    {dashboard.description && (
                        <p className="text-gray-500 mb-6">{dashboard.description}</p>
                    )}
                    <DashboardGrid
                        widgets={widgets}
                        widgetData={widgetData}
                        isDataLoading={false}
                        isEditing={false}
                        onLayoutChange={() => {}}
                        onConfigureWidget={() => {}}
                        onDeleteWidget={() => {}}
                    />
                </div>
            </div>
        </>
    );
}
