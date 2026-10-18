import type { EsignStatus } from "../api/client";
import { Button } from "@/components/ui/button";

export function AlimtalkReadiness({ status, onRefresh }: { status: EsignStatus; onRefresh?: () => void }) {
    return <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm" aria-label="전자서명 발송 준비 상태">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">이메일: {status.emailReady ? "사용 가능" : "설정 필요"} · 알림톡: {status.alimtalkReady ? "사용 가능" : "준비 중"}</p>{onRefresh && <Button size="sm" variant="outline" onClick={onRefresh}>승인 상태 새로고침</Button>}</div>
        {status.alimtalk?.channelName && <p>알림톡 발신 채널: <strong>{status.alimtalk.channelName}</strong> · 선택한 사업과 발신 채널이 맞는지 확인해주세요.</p>}
        {status.alimtalk?.templates.length ? <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">{status.alimtalk.templates.map(t => <li key={t.code}>{t.label}: {t.state}</li>)}</ul> : null}
        {!status.alimtalkReady && <p className="text-xs text-amber-800">{status.alimtalk?.reason || "알림톡 연결과 전자서명 템플릿 승인이 필요합니다."} {status.emailReady ? "지금은 이메일만 선택해 보낼 수 있습니다." : "이메일 설정을 마치면 이메일만 선택해 보낼 수 있습니다."}</p>}
        <p className="text-xs text-muted-foreground">알림톡 실패 시 SMS로 자동 전환하지 않습니다.</p>
    </div>;
}
