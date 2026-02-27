import { useState, useEffect } from "react";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface UserToolbarProps {
    onSearch: (keyword: string) => void;
    onCreateClick: () => void;
}

export default function UserToolbar({ onSearch, onCreateClick }: UserToolbarProps) {
    const [searchInput, setSearchInput] = useState("");

    useEffect(() => {
        const timer = setTimeout(() => {
            onSearch(searchInput);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput, onSearch]);

    return (
        <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="이름 또는 이메일로 검색..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-8 h-9"
                />
            </div>

            <div className="flex-1" />

            <Button size="sm" onClick={onCreateClick} className="gap-1.5">
                <Plus className="h-4 w-4" />
                사용자 추가
            </Button>
        </div>
    );
}
