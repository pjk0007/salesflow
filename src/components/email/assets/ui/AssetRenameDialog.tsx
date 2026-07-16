import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EmailAsset } from "../types";

interface AssetRenameDialogProps {
    asset: EmailAsset | null;
    onClose: () => void;
    onSave: (id: number, name: string) => Promise<void>;
}

export default function AssetRenameDialog({ asset, onClose, onSave }: AssetRenameDialogProps) {
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (asset) setName(asset.name);
    }, [asset]);

    const handleSave = async () => {
        if (!asset || !name.trim()) return;
        setSaving(true);
        try {
            await onSave(asset.id, name.trim());
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={!!asset} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>에셋 이름 수정</DialogTitle>
                </DialogHeader>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                    placeholder="에셋 이름"
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                />
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        취소
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !name.trim()}>
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
