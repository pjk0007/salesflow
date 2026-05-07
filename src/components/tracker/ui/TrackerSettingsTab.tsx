"use client";

import { useState, useMemo } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useTrackerSite } from "../hooks/useTrackerSite";
import { TrackerSetupForm } from "./TrackerSetupForm";
import { EmbedScriptCard } from "./EmbedScriptCard";
import { DomainEditor } from "./DomainEditor";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export default function TrackerSettingsTab() {
    const { workspaces } = useWorkspaces();
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);

    const workspaceId = useMemo(() => {
        return selectedWorkspaceId ?? workspaces?.[0]?.id ?? null;
    }, [selectedWorkspaceId, workspaces]);

    const { site, isLoading, mutate } = useTrackerSite(workspaceId);

    if (!workspaceId || !workspaces || workspaces.length === 0) {
        return <p className="text-sm text-muted-foreground">먼저 워크스페이스를 만들어주세요.</p>;
    }

    return (
        <div className="space-y-6">
            {workspaces.length > 1 && (
                <div>
                    <Select
                        value={String(workspaceId)}
                        onValueChange={(v) => setSelectedWorkspaceId(Number(v))}
                    >
                        <SelectTrigger className="w-72">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {workspaces.map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>
                                    {w.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {isLoading ? (
                <div className="space-y-4">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                </div>
            ) : !site ? (
                <TrackerSetupForm workspaceId={workspaceId} onCreated={() => mutate()} />
            ) : (
                <>
                    <EmbedScriptCard apiKey={site.apiKey} />
                    <DomainEditor
                        siteId={site.id}
                        domains={site.domains}
                        onUpdated={() => mutate()}
                    />
                </>
            )}
        </div>
    );
}
