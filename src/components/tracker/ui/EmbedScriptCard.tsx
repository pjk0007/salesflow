"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy } from "lucide-react";
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
            <CardHeader>
                <CardTitle className="text-base">설치 스크립트</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                    아래 스크립트를 추적할 사이트의 <code className="text-xs bg-muted px-1 py-0.5 rounded">{"<head>"}</code> 안에 붙여넣어 주세요.
                </p>
                <div className="relative">
                    <pre className="rounded-lg border bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                        <code>{snippet}</code>
                    </pre>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-8 w-8"
                        onClick={handleCopy}
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
