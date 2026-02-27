import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { TemplatePerformance } from "@/hooks/useAnalytics";

interface TemplateRankingProps {
    data: TemplatePerformance[];
}

export default function TemplateRanking({ data }: TemplateRankingProps) {
    if (data.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-6">
                해당 기간의 템플릿 발송 이력이 없습니다.
            </p>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>템플릿명</TableHead>
                    <TableHead className="w-[80px]">채널</TableHead>
                    <TableHead className="w-[70px] text-right">전체</TableHead>
                    <TableHead className="w-[70px] text-right">성공</TableHead>
                    <TableHead className="w-[70px] text-right">실패</TableHead>
                    <TableHead className="w-[80px] text-right">성공률</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((item, index) => (
                    <TableRow key={`${item.channel}-${item.name}-${index}`}>
                        <TableCell className="text-muted-foreground">
                            {index + 1}
                        </TableCell>
                        <TableCell className="font-medium truncate max-w-[200px]">
                            {item.name}
                        </TableCell>
                        <TableCell>
                            <Badge variant={item.channel === "alimtalk" ? "default" : "secondary"}>
                                {item.channel === "alimtalk" ? "알림톡" : "이메일"}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">{item.total}</TableCell>
                        <TableCell className="text-right text-green-600">{item.sent}</TableCell>
                        <TableCell className="text-right text-red-600">{item.failed}</TableCell>
                        <TableCell className="text-right font-medium">
                            {item.successRate}%
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
