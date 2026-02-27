import Link from "next/link";
import { Button } from "@/components/ui/button";
import StepIndicator from "./StepIndicator";

interface OnboardingLayoutProps {
    currentStep: number;
    totalSteps: number;
    onSkipAll: () => void;
    children: React.ReactNode;
    onPrev?: () => void;
    onNext?: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    isLoading?: boolean;
    showNav?: boolean;
}

export default function OnboardingLayout({
    currentStep,
    totalSteps,
    onSkipAll,
    children,
    onPrev,
    onNext,
    nextLabel = "다음",
    nextDisabled = false,
    isLoading = false,
    showNav = true,
}: OnboardingLayoutProps) {
    return (
        <div className="flex min-h-screen flex-col">
            {/* Header */}
            <header className="flex items-center justify-between border-b px-6 py-3">
                <Link href="/" className="text-xl font-bold">
                    SalesFlow
                </Link>
                <Button variant="ghost" size="sm" onClick={onSkipAll}>
                    건너뛰기
                </Button>
            </header>

            {/* Content */}
            <div className="flex flex-1 flex-col items-center px-4 py-8">
                <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />

                <div className="mt-8 w-full max-w-lg">
                    {children}
                </div>

                {/* Navigation */}
                {showNav && (
                    <div className="mt-8 flex items-center gap-4">
                        {onPrev && (
                            <Button variant="outline" onClick={onPrev} disabled={isLoading}>
                                이전
                            </Button>
                        )}
                        {onNext && (
                            <Button onClick={onNext} disabled={nextDisabled || isLoading}>
                                {isLoading ? "처리 중..." : nextLabel}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
