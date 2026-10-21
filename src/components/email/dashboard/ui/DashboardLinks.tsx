import { Button } from "@/components/ui/button";
import { useDashboardLinks } from "../hooks/useDashboardLinks";
export function DashboardLinks({ onTabChange }: { onTabChange?: (tab: string) => void }) {
    const links = useDashboardLinks(onTabChange);
    return <div className="flex flex-wrap gap-3">{links.map(link => <Button key={link.tab} variant="outline" onClick={link.onClick}>{link.label}</Button>)}</div>;
}
