"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import ImportDialog from "@/components/records/ImportDialog";
import { useSession } from "@/contexts/SessionContext";
import { bulkCreateSalesLeads } from "../api";
import { SALES_IMPORT_FIELDS } from "../utils/import-fields";
import { OwnerSelect } from "./OwnerSelect";
import { WorkspaceChips } from "./WorkspaceChips";

/**
 * 엑셀·CSV로 영업 리드 한 번에 추가 — ① 사업부·담당자 고르기 → ② 레코드 가져오기와 같은 창(파일 → 칸 맞추기 → 결과)
 * 같은 이메일의 영업고객이 이미 있으면 건너뛰거나 오류로 센다.
 */
export function SalesImportButton({ workspaceId, onImported }: { workspaceId: number | null; onImported: () => void }) {
    const { user } = useSession();
    const [step, setStep] = useState<"none" | "setup" | "import">("none");
    const [workspaceIds, setWorkspaceIds] = useState<number[]>(workspaceId ? [workspaceId] : []);
    const [ownerId, setOwnerId] = useState<string | null>(user?.id ?? null);

    return (
        <>
            <Button size="sm" variant="outline" onClick={() => setStep("setup")}>
                <FileSpreadsheet className="mr-1 h-4 w-4" />
                파일로 추가
            </Button>

            <Dialog open={step === "setup"} onOpenChange={(v) => !v && setStep("none")}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>파일로 영업고객 추가</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">사업부</Label>
                            <WorkspaceChips value={workspaceIds} onChange={setWorkspaceIds} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">담당자 (일괄 적용)</Label>
                            <OwnerSelect value={ownerId} onChange={setOwnerId} className="-ml-2 text-sm" block />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStep("none")}>
                            취소
                        </Button>
                        <Button disabled={workspaceIds.length === 0} onClick={() => setStep("import")}>
                            다음
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ImportDialog
                open={step === "import"}
                onOpenChange={(v) => {
                    if (!v) {
                        setStep("none");
                        onImported();
                    }
                }}
                fields={SALES_IMPORT_FIELDS}
                duplicatePolicy={{
                    fieldLabel: "이메일",
                    action: "reject",
                    askSkipOrError: true,
                    notice: "같은 이메일의 영업고객이 이미 있으면 건너뛰거나 오류로 표시해요.",
                }}
                onImport={(rows, duplicateAction) => bulkCreateSalesLeads({ workspaceIds, ownerId, records: rows, duplicateAction })}
            />
        </>
    );
}
