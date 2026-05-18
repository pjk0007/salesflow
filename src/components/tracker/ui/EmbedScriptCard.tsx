"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy, Code2 } from "lucide-react";
import { buildEmbedScript } from "../utils/embedScript";

export function EmbedScriptCard({ apiKey }: { apiKey: string }) {
    const [copied, setCopied] = useState(false);

    const baseUrl = useMemo(() => {
        if (typeof window === "undefined") return "https://sendb.kr";
        return window.location.origin;
    }, []);

    const snippet = buildEmbedScript({ apiKey, baseUrl });

    const handleCopy = () => {
        navigator.clipboard.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Code2 className="h-4 w-4 text-muted-foreground" />
                    설치 스크립트
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    아래 스크립트를 추적할 사이트의{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                        {"<head>"}
                    </code>{" "}
                    안에 붙여넣고 배포하면 추적이 시작됩니다.
                </p>
                <div className="group relative">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/60 p-4 pr-12 text-xs font-mono leading-relaxed">
                        <code>{snippet}</code>
                    </pre>
                    <Button
                        variant={copied ? "default" : "secondary"}
                        size="sm"
                        className="absolute right-2 top-2 h-7 gap-1 px-2 text-xs"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <>
                                <Check className="h-3.5 w-3.5" />
                                복사됨
                            </>
                        ) : (
                            <>
                                <Copy className="h-3.5 w-3.5" />
                                복사
                            </>
                        )}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
