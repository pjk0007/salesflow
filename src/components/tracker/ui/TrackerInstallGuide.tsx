"use client";

import { EmbedScriptCard } from "./EmbedScriptCard";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * 트래커는 만들었지만 아직 방문자가 0명일 때 보여주는 설치 안내.
 */
export function TrackerInstallGuide({ apiKey }: { apiKey: string }) {
    return (
        <div className="space-y-4">
            {/* 안내 배너 */}
            <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                <div>
                    <p className="text-sm font-medium">
                        스크립트 설치를 기다리고 있습니다
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                        아래 스크립트를 사이트에 설치하면 방문자 데이터가 자동으로 수집됩니다.
                    </p>
                </div>
            </div>

            {/* 설치 스크립트 */}
            <EmbedScriptCard apiKey={apiKey} />

            {/* 설치 절차 */}
            <div className="rounded-xl border bg-card p-5">
                <p className="text-sm font-medium">설치 방법</p>
                <ol className="mt-3 space-y-2.5">
                    <Step n={1}>
                        위 스크립트를 복사합니다.
                    </Step>
                    <Step n={2}>
                        추적할 사이트의{" "}
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {"<head>"}
                        </code>{" "}
                        태그 안에 붙여넣습니다.
                    </Step>
                    <Step n={3}>
                        사이트를 배포하면 방문자 추적이 시작됩니다. 데이터가 들어오면
                        이 화면이 자동으로 갱신됩니다.
                    </Step>
                </ol>
            </div>

            {/* 다음 안내 */}
            <div className="flex items-start gap-2.5 rounded-xl border bg-muted/40 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                    이메일을 발송하면 메일을 클릭한 방문자는 자동으로 해당 고객 레코드에
                    연결됩니다. 회원가입·결제 같은 특정 행동을 추적하려면{" "}
                    <code className="rounded bg-background px-1 py-0.5 text-[11px] font-mono">
                        sendb.track()
                    </code>{" "}
                    코드를 추가하세요.
                </p>
            </div>
        </div>
    );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {n}
            </span>
            <span className="text-sm text-muted-foreground">{children}</span>
        </li>
    );
}
