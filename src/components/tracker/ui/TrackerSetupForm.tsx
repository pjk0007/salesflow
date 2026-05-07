"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { createTrackerSite } from "../api/trackerSites";

export function TrackerSetupForm({
    workspaceId,
    onCreated,
}: {
    workspaceId: number;
    onCreated: () => void;
}) {
    const [name, setName] = useState("");
    const [domains, setDomains] = useState<string[]>([]);
    const [domainInput, setDomainInput] = useState("");
    const [saving, setSaving] = useState(false);

    const addDomain = () => {
        const trimmed = domainInput.trim().toLowerCase().replace(/^https?:\/\//, "");
        if (!trimmed) return;
        if (domains.includes(trimmed)) return;
        setDomains([...domains, trimmed]);
        setDomainInput("");
    };

    const submit = async () => {
        if (!name.trim()) {
            toast.error("트래커 이름을 입력하세요.");
            return;
        }
        // input에 값이 남아 있으면 자동으로 추가
        const pending = domainInput.trim().toLowerCase().replace(/^https?:\/\//, "");
        const finalDomains = pending && !domains.includes(pending)
            ? [...domains, pending]
            : domains;
        if (finalDomains.length === 0) {
            toast.error("도메인을 최소 1개 등록하세요.");
            return;
        }
        setSaving(true);
        try {
            await createTrackerSite({ workspaceId, name: name.trim(), domains: finalDomains });
            toast.success("트래커가 생성되었습니다.");
            onCreated();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "생성 실패");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">트래커 시작하기</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="tracker-name">이름</Label>
                    <Input
                        id="tracker-name"
                        placeholder="예: 메인 사이트"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div>
                    <Label>도메인</Label>
                    <div className="space-y-2">
                        {domains.map((d) => (
                            <div key={d} className="flex items-center gap-2 rounded border px-3 py-2">
                                <span className="flex-1 text-sm">{d}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setDomains(domains.filter((x) => x !== d))}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <Input
                            placeholder="example.com"
                            value={domainInput}
                            onChange={(e) => setDomainInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    addDomain();
                                }
                            }}
                        />
                        <Button variant="outline" onClick={addDomain} disabled={!domainInput.trim()}>
                            <Plus className="mr-1 h-4 w-4" /> 추가
                        </Button>
                    </div>
                </div>
                <Button onClick={submit} disabled={saving} className="w-full">
                    {saving ? "생성 중..." : "트래커 만들기"}
                </Button>
            </CardContent>
        </Card>
    );
}
