"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, X, MousePointerClick, Route, UserCheck, Activity } from "lucide-react";
import { createTrackerSite } from "../api/trackerSites";
import { normalizeDomain } from "../utils/normalizeDomain";

const STEPS = [
    {
        icon: MousePointerClick,
        title: "이메일 클릭 추적",
        desc: "발송한 메일의 링크를 누가 클릭했는지 자동으로 기록합니다.",
    },
    {
        icon: Route,
        title: "사이트 행동 수집",
        desc: "스크립트 한 줄로 방문 페이지·체류·이벤트를 추적합니다.",
    },
    {
        icon: UserCheck,
        title: "리드와 자동 연결",
        desc: "메일을 클릭한 방문자를 해당 고객 레코드에 자동 매칭합니다.",
    },
];

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
        const normalized = normalizeDomain(domainInput);
        if (!normalized) return;
        if (domains.includes(normalized)) return;
        setDomains([...domains, normalized]);
        setDomainInput("");
    };

    const submit = async () => {
        if (!name.trim()) {
            toast.error("트래커 이름을 입력하세요.");
            return;
        }
        const pending = normalizeDomain(domainInput);
        const finalDomains =
            pending && !domains.includes(pending) ? [...domains, pending] : domains;
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
        <div className="mx-auto max-w-2xl">
            {/* 히어로 */}
            <div className="flex flex-col items-center text-center py-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                    <Activity className="h-7 w-7 text-primary" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">트래커 시작하기</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    방문자의 행동을 수집해 리드와 연결하는 트래커를 만들어보세요.
                </p>
            </div>

            {/* 작동 흐름 3단계 */}
            <div className="grid gap-3 sm:grid-cols-3">
                {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    return (
                        <div
                            key={s.title}
                            className="rounded-xl border bg-card p-4"
                        >
                            <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
                                    <Icon className="h-4 w-4 text-foreground" />
                                </div>
                                <span className="text-xs font-medium text-muted-foreground">
                                    STEP {i + 1}
                                </span>
                            </div>
                            <div className="mt-2 text-sm font-medium">{s.title}</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {s.desc}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* 생성 폼 */}
            <div className="mt-6 rounded-xl border bg-card p-5">
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="tracker-name">트래커 이름</Label>
                        <Input
                            id="tracker-name"
                            placeholder="예: 메인 사이트"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="tracker-domain">추적할 도메인</Label>
                        {domains.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {domains.map((d) => (
                                    <span
                                        key={d}
                                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                                    >
                                        {d}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDomains(domains.filter((x) => x !== d))
                                            }
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Input
                                id="tracker-domain"
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
                            <Button
                                type="button"
                                variant="outline"
                                onClick={addDomain}
                                disabled={!domainInput.trim()}
                            >
                                <Plus className="mr-1 h-4 w-4" />
                                추가
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            추적할 사이트의 도메인을 입력하세요. 여러 개 등록할 수 있습니다.
                        </p>
                    </div>

                    <Button onClick={submit} disabled={saving} className="w-full">
                        {saving ? "생성 중..." : "트래커 만들기"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
