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
    // iframe src가 고정이면 부모 URL의 sendb_cid·utm_*가 폼에 전달되지 않아
    // 유입 캠페인을 알 수 없다. 스크립트로 만들어 부모의 search를 넘긴다.
    const scriptEmbedCode = `<div id="sendb-form-${slug}"></div>
<script>
(function () {
    var f = document.createElement("iframe");
    f.src = "${formUrl}" + window.location.search;
    f.width = "100%";
    f.height = "600";
    f.frameBorder = "0";
    f.style.border = "none";
    document.getElementById("sendb-form-${slug}").appendChild(f);
})();
</script>`;

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
                        <label className="text-sm font-medium">임베드 코드 (권장)</label>
                        <p className="text-xs text-muted-foreground">
                            메일·광고 링크의 유입 정보(캠페인)가 리드에 함께 기록됩니다.
                        </p>
                        <Textarea readOnly value={scriptEmbedCode} rows={13} className="font-mono text-xs" />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                navigator.clipboard.writeText(scriptEmbedCode);
                                toast.success("임베드 코드가 복사되었습니다.");
                            }}
                        >
                            코드 복사
                        </Button>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">iframe 코드</label>
                        <p className="text-xs text-muted-foreground">
                            스크립트를 쓸 수 없을 때만 사용하세요. 유입 캠페인이 기록되지 않습니다.
                        </p>
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
