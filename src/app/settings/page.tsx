import { redirect } from "next/navigation";

export default async function SettingsRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const { tab } = await searchParams;
    redirect(tab === "billing" ? "/settings/billing" : tab === "users" ? "/settings/organization?tab=team" : "/settings/organization");
}