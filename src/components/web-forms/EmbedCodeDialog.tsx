import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface EmbedCodeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    slug: string;
}

export default function EmbedCodeDialog({
    open,
    onOpenChange,
    slug,
}: EmbedCodeDialogProps) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const formUrl = `${origin}/f/${slug}`;
    const embedCode = `<iframe src="${formUrl}" width="100%" height="600" frameborder="0" style="border: none;"></iframe>`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>임베드 코드</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">직접 링크</label>
                        <div className="flex items-center gap-2">
                            <input
                                readOnly
                                value={formUrl}
                                className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted"
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    navigator.clipboard.writeText(formUrl);
                                    toast.success("링크가 복사되었습니다.");
                                }}
                            >
                                복사
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">iframe 코드</label>
                        <Textarea readOnly value={embedCode} rows={4} className="font-mono text-xs" />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                navigator.clipboard.writeText(embedCode);
                                toast.success("임베드 코드가 복사되었습니다.");
                            }}
                        >
                            코드 복사
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
