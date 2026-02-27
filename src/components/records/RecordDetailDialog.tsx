import { useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MessageSquare, Mail } from "lucide-react";
import CellRenderer from "./CellRenderer";
import CompanyResearchSection from "./CompanyResearchSection";
import SendAlimtalkDialog from "@/components/alimtalk/SendAlimtalkDialog";
import SendEmailDialog from "./SendEmailDialog";
import UnifiedLogTable from "@/components/logs/UnifiedLogTable";
import { useAiConfig } from "@/hooks/useAiConfig";
import type { DbRecord } from "@/lib/db";
import type { FieldDefinition } from "@/types";

interface RecordDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    record: DbRecord | null;
    fields: FieldDefinition[];
    partitionId: number;
    onRecordUpdated?: () => void;
}

export default function RecordDetailDialog({
    open,
    onOpenChange,
    record,
    fields,
    partitionId,
    onRecordUpdated,
}: RecordDetailDialogProps) {
    const [alimtalkOpen, setAlimtalkOpen] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);
    const { config: aiConfig } = useAiConfig();

    if (!record) return null;

    const data = record.data as Record<string, unknown>;

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="sm:max-w-lg overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>{record.integratedCode}</SheetTitle>
                        <SheetDescription>레코드 상세 정보</SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6 px-4">
                        {/* 메타 정보 */}
                        <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                <span className="text-sm text-muted-foreground">등록일</span>
                                <span className="col-span-2 text-sm">
                                    {record.registeredAt
                                        ? new Date(record.registeredAt).toLocaleString("ko-KR")
                                        : "-"}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                <span className="text-sm text-muted-foreground">수정일</span>
                                <span className="col-span-2 text-sm">
                                    {record.updatedAt
                                        ? new Date(record.updatedAt).toLocaleString("ko-KR")
                                        : "-"}
                                </span>
                            </div>
                        </div>

                        {/* 필드 목록 */}
                        <div className="space-y-0">
                            {fields.map((field) => (
                                <div
                                    key={field.key}
                                    className="grid grid-cols-3 gap-2 py-2 border-b last:border-0"
                                >
                                    <span className="text-sm text-muted-foreground">
                                        {field.label}
                                    </span>
                                    <span className="col-span-2 text-sm">
                                        <CellRenderer field={field} value={data[field.key]} />
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* 회사 정보 (AI 설정 있을 때만) */}
                        {aiConfig && (
                            <CompanyResearchSection
                                recordId={record.id}
                                recordData={data}
                                fields={fields}
                                onUpdated={() => onRecordUpdated?.()}
                            />
                        )}

                        {/* 발송 이력 */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium text-muted-foreground">발송 이력</h3>
                            <UnifiedLogTable recordId={record.id} compact />
                        </div>
                    </div>

                    <SheetFooter className="flex-row gap-2">
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => setAlimtalkOpen(true)}
                        >
                            <MessageSquare className="h-4 w-4 mr-2" />
                            알림톡 발송
                        </Button>
                        <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => setEmailOpen(true)}
                        >
                            <Mail className="h-4 w-4 mr-2" />
                            이메일 발송
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <SendAlimtalkDialog
                open={alimtalkOpen}
                onOpenChange={setAlimtalkOpen}
                partitionId={partitionId}
                recordIds={[record.id]}
            />
            <SendEmailDialog
                open={emailOpen}
                onOpenChange={setEmailOpen}
                partitionId={partitionId}
                recordIds={[record.id]}
            />
        </>
    );
}
