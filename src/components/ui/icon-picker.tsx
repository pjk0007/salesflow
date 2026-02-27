import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
    Briefcase,
    Building2,
    Store,
    Landmark,
    Factory,
    Users,
    UserRound,
    Contact,
    HeartHandshake,
    Phone,
    Mail,
    MessageSquare,
    Megaphone,
    BarChart3,
    PieChart,
    TrendingUp,
    Target,
    Home,
    Star,
    Globe,
    Rocket,
    Zap,
    Shield,
    Crown,
    Gem,
    Smile,
} from "lucide-react";

const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
    // 비즈니스
    { name: "Briefcase", icon: Briefcase },
    { name: "Building2", icon: Building2 },
    { name: "Store", icon: Store },
    { name: "Landmark", icon: Landmark },
    { name: "Factory", icon: Factory },
    // 사람
    { name: "Users", icon: Users },
    { name: "UserRound", icon: UserRound },
    { name: "Contact", icon: Contact },
    { name: "HeartHandshake", icon: HeartHandshake },
    // 커뮤니케이션
    { name: "Phone", icon: Phone },
    { name: "Mail", icon: Mail },
    { name: "MessageSquare", icon: MessageSquare },
    { name: "Megaphone", icon: Megaphone },
    // 데이터
    { name: "BarChart3", icon: BarChart3 },
    { name: "PieChart", icon: PieChart },
    { name: "TrendingUp", icon: TrendingUp },
    { name: "Target", icon: Target },
    // 일반
    { name: "Home", icon: Home },
    { name: "Star", icon: Star },
    { name: "Globe", icon: Globe },
    { name: "Rocket", icon: Rocket },
    { name: "Zap", icon: Zap },
    { name: "Shield", icon: Shield },
    { name: "Crown", icon: Crown },
    { name: "Gem", icon: Gem },
];

const ICON_MAP = new Map(ICON_OPTIONS.map((o) => [o.name, o.icon]));

export function getIconComponent(name: string): LucideIcon | null {
    return ICON_MAP.get(name) ?? null;
}

interface IconPickerProps {
    value: string;
    onChange: (icon: string) => void;
}

export default function IconPicker({ value, onChange }: IconPickerProps) {
    const [open, setOpen] = useState(false);
    const SelectedIcon = value ? getIconComponent(value) : null;

    const handleSelect = (name: string) => {
        onChange(name);
        setOpen(false);
    };

    const handleClear = () => {
        onChange("");
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className="w-full justify-start gap-2 font-normal"
                >
                    {SelectedIcon ? (
                        <>
                            <SelectedIcon className="h-4 w-4" />
                            <span>{value}</span>
                        </>
                    ) : (
                        <span className="text-muted-foreground">
                            <Smile className="inline h-4 w-4 mr-1" />
                            아이콘 선택
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-3" align="start">
                <div className="grid grid-cols-5 gap-1">
                    {ICON_OPTIONS.map((opt) => (
                        <Button
                            key={opt.name}
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-9 w-9",
                                value === opt.name && "bg-accent"
                            )}
                            onClick={() => handleSelect(opt.name)}
                            title={opt.name}
                        >
                            <opt.icon className="h-4 w-4" />
                        </Button>
                    ))}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2 text-muted-foreground"
                    onClick={handleClear}
                >
                    없음
                </Button>
            </PopoverContent>
        </Popover>
    );
}
