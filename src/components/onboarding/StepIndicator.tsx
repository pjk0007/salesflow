import { cn } from "@/lib/utils";

interface StepIndicatorProps {
    currentStep: number;
    totalSteps: number;
}

const STEP_LABELS = ["환영", "워크스페이스", "필드", "초대", "완료"];

export default function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
    return (
        <div className="flex items-center justify-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                        <div
                            className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                                i + 1 < currentStep
                                    ? "bg-primary text-primary-foreground"
                                    : i + 1 === currentStep
                                      ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                                      : "bg-muted text-muted-foreground"
                            )}
                        >
                            {i + 1}
                        </div>
                        <span className="text-xs text-muted-foreground hidden sm:block">
                            {STEP_LABELS[i]}
                        </span>
                    </div>
                    {i < totalSteps - 1 && (
                        <div
                            className={cn(
                                "h-0.5 w-8 sm:w-12 mb-5 sm:mb-5",
                                i + 1 < currentStep ? "bg-primary" : "bg-muted"
                            )}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}
