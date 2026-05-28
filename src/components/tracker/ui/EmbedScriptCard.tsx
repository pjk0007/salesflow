"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Check, Copy, Code2, ChevronDown, UserCheck } from "lucide-react";
import { buildEmbedScript } from "../utils/embedScript";

const IDENTIFY_SNIPPET = `// 로그인 성공 직후, 사용자 정보가 확정된 시점에 호출
window.sendb?.identify({
    userId: "internal-user-id", // 선택. 내부 식별자(매칭 필드로 사용 가능)
    email: "user@example.com",  // 선택
    name: "홍길동",              // 선택
    phone: "010-1234-5678",     // 선택
});

// 이메일만 빠르게 식별하고 싶다면
window.sendb?.identify("user@example.com");`;

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
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
    );
}

export function EmbedScriptCard({ apiKey }: { apiKey: string }) {
    const baseUrl = useMemo(() => {
        if (typeof window === "undefined") return "https://sendb.kr";
        return window.location.origin;
    }, []);

    const snippet = buildEmbedScript({ apiKey, baseUrl });

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Code2 className="h-4 w-4 text-muted-foreground" />
                    설치 스크립트
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* 1. 기본 스크립트 */}
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                        아래 스크립트를 추적할 사이트의{" "}
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {"<head>"}
                        </code>{" "}
                        안에 붙여넣고 배포하면 익명 추적이 시작됩니다.
                    </p>
                    <div className="group relative">
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/60 p-4 pr-12 text-xs font-mono leading-relaxed">
                            <code>{snippet}</code>
                        </pre>
                        <CopyButton text={snippet} />
                    </div>
                </div>

                {/* 2. 로그인 사용자 식별 (선택) */}
                <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors group">
                        <UserCheck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">로그인 사용자 식별하기 (선택)</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                            익명 방문자에 이메일·이름 매칭
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-x border-b rounded-b-md px-3 py-3 space-y-3">
                        <div className="space-y-1 text-sm text-muted-foreground">
                            <p>
                                스크립트만 박으면 방문자는{" "}
                                <strong className="text-foreground">익명</strong>
                                으로만 추적됩니다. 로그인한 사용자가 누구인지
                                트래커에서 보고 싶다면, 사이트의 로그인 성공
                                직후에 아래 함수를 호출해 주세요.
                            </p>
                            <p>
                                내부 매칭 필드(예: 회원 ID, 이메일, 전화번호)와
                                일치하는 레코드가 있으면 자동으로 CRM 레코드와
                                연결됩니다. 같은 사용자가 다른 디바이스/브라우저로
                                접속해도 자동으로 묶입니다.
                            </p>
                        </div>
                        <div className="group relative">
                            <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-4 pr-12 text-xs font-mono leading-relaxed">
                                <code>{IDENTIFY_SNIPPET}</code>
                            </pre>
                            <CopyButton text={IDENTIFY_SNIPPET} />
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                            <strong>참고.</strong> 호출 시점은 보통{" "}
                            <code className="font-mono">로그인 성공 콜백</code>{" "}
                            또는{" "}
                            <code className="font-mono">
                                AuthProvider의 user 상태 변경
                            </code>{" "}
                            useEffect 안입니다. 모든 필드는 선택값이며, 가지고
                            있는 정보만 넘기면 됩니다.
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </CardContent>
        </Card>
    );
}
