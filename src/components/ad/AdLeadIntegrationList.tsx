"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAdLeadIntegrations } from "@/hooks/useAdLeadIntegrations";
import { Plus } from "lucide-react";
import type { AdPlatformType } from "@/types";
import CreateIntegrationDialog from "@/components/ad/CreateIntegrationDialog";

const PLATFORM_LABELS: Record<AdPlatformType, string> = {
    meta: "Meta",
    google: "Google",
    naver: "Naver",
};

export default function AdLeadIntegrationList() {
    const { integrations, isLoading, updateIntegration, mutate } = useAdLeadIntegrations();
    const [dialogOpen, setDialogOpen] = useState(false);

    const handleToggle = async (id: number, currentActive: number) => {
        const newActive = currentActive === 1 ? 0 : 1;
        const result = await updateIntegration(id, { isActive: newActive });
        if (result.success) {
            toast.success(newActive === 1 ? "연동이 활성화되었습니다." : "연동이 비활성화되었습니다.");
        } else {
            toast.error(result.error || "상태 변경에 실패했습니다.");
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>리드 연동</CardTitle>
                    <CardDescription>
                        광고 플랫폼의 리드 폼과 파티션을 연동하여 자동으로 리드를 수집합니다.
                    </CardDescription>
                </div>
                <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    연동 추가
                </Button>
            </CardHeader>
            <CardContent>
                {integrations.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        등록된 리드 연동이 없습니다.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>이름</TableHead>
                                <TableHead>플랫폼</TableHead>
                                <TableHead>리드 폼</TableHead>
                                <TableHead>대상 파티션</TableHead>
                                <TableHead>상태</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {integrations.map((integration) => (
                                <TableRow key={integration.id}>
                                    <TableCell className="font-medium">
                                        {integration.name}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary">
                                            {PLATFORM_LABELS[integration.platform]}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {integration.formName || integration.formId}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {integration.partitionName || (integration.partitionId ? `#${integration.partitionId}` : "-")}
                                    </TableCell>
                                    <TableCell>
                                        <Switch
                                            checked={integration.isActive === 1}
                                            onCheckedChange={() => handleToggle(integration.id, integration.isActive)}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
            <CreateIntegrationDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                onCreated={() => mutate()}
            />
        </Card>
    );
}
