"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { updateTrackerSite } from "../api/trackerSites";
import { normalizeDomain } from "../utils/normalizeDomain";

export function DomainEditor({
    siteId,
    domains,
    onUpdated,
}: {
    siteId: number;
    domains: string[];
    onUpdated: () => void;
}) {
    const [newDomain, setNewDomain] = useState("");
    const [saving, setSaving] = useState(false);

    const handleAdd = async () => {
        const trimmed = normalizeDomain(newDomain);
        if (!trimmed) return;
        if (domains.includes(trimmed)) {
            toast.error("이미 등록된 도메인입니다.");
            return;
        }
        setSaving(true);
        try {
            await updateTrackerSite(siteId, { domains: [...domains, trimmed] });
            setNewDomain("");
            onUpdated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "추가 실패");
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (target: string) => {
        if (domains.length === 1) {
            toast.error("최소 1개의 도메인이 필요합니다.");
            return;
        }
        setSaving(true);
        try {
            await updateTrackerSite(siteId, {
                domains: domains.filter((d) => d !== target),
            });
            onUpdated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "삭제 실패");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">허용 도메인</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                    이 도메인에서만 트래커 데이터 수집이 허용됩니다.
                </p>
                <div className="space-y-2">
                    {domains.map((d) => (
                        <div key={d} className="flex items-center gap-2 rounded border px-3 py-2">
                            <span className="flex-1 text-sm">{d}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRemove(d)}
                                disabled={saving}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
                <div className="mt-3 flex gap-2">
                    <Input
                        placeholder="example.com"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAdd();
                            }
                        }}
                    />
                    <Button onClick={handleAdd} disabled={saving || !newDomain.trim()}>
                        <Plus className="mr-1 h-4 w-4" /> 추가
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
