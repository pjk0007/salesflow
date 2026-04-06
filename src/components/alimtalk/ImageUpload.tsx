import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
import { toast } from "sonner";

interface ImageUploadProps {
    value: string;
    onChange: (url: string, fileName?: string) => void;
    label?: string;
    aspect?: string;
}

export default function ImageUpload({ value, onChange, label, aspect = "aspect-[2/1]" }: ImageUploadProps) {
    const [uploading, setUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await res.json();

            if (result.success) {
                onChange(result.data.url, result.data.fileName);
                toast.success("이미지가 업로드되었습니다.");
            } else {
                toast.error(result.error || "업로드에 실패했습니다.");
            }
        } catch {
            toast.error("업로드 중 오류가 발생했습니다.");
        } finally {
            setUploading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file);
        e.target.value = "";
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) {
            handleUpload(file);
        }
    };

    if (value) {
        return (
            <div className="relative group">
                {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
                <div className={`relative rounded-lg overflow-hidden border ${aspect}`}>
                    <img
                        src={value}
                        alt="uploaded"
                        className="w-full h-full object-cover"
                    />
                    <button
                        type="button"
                        onClick={() => onChange("", "")}
                        className="absolute top-1.5 right-1.5 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            {label && <p className="text-xs text-muted-foreground mb-1">{label}</p>}
            <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 transition-colors ${aspect}`}
                onClick={() => inputRef.current?.click()}
            >
                {uploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                    <>
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        <div className="flex items-center gap-1.5">
                            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">클릭 또는 드래그하여 업로드</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">JPG, PNG, GIF, WebP (최대 5MB)</span>
                    </>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleFileChange}
            />
        </div>
    );
}
