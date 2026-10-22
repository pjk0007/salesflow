import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChatSpaces } from "../hooks/useChatSpaces";

interface Props {
    /** null이면 알림 꺼짐 */
    value: number | null;
    onChange: (spaceId: number | null) => void;
    /** 켜기만 하고 아직 스페이스를 고르지 않은 상태 */
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
}

/** 파티션 설정 안의 '구글챗 알림' 칸 (관리자에게만 보여준다) */
export default function PartitionChatAlertSection({ value, onChange, enabled, onEnabledChange }: Props) {
    const { spaces, isLoading } = useChatSpaces();

    return (
        <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-base font-semibold">구글챗 알림</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        웹폼·외부 API·광고로 리드가 들어오면 알립니다. 직접 추가하거나 가져온 레코드는 알리지 않습니다.
                    </p>
                </div>
                <Switch
                    checked={enabled}
                    onCheckedChange={(on) => {
                        onEnabledChange(on);
                        if (!on) onChange(null);
                    }}
                />
            </div>

            {enabled && (
                isLoading ? null : spaces.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        등록된 스페이스가 없습니다.{" "}
                        <Link href="/settings/organization?tab=chat-spaces" className="underline">
                            조직 설정에서 등록
                        </Link>
                        한 뒤 고를 수 있습니다.
                    </p>
                ) : (
                    <div className="space-y-1">
                        <Label className="text-sm">알릴 스페이스</Label>
                        <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
                            <SelectTrigger>
                                <SelectValue placeholder="스페이스 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {spaces.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )
            )}
        </div>
    );
}
