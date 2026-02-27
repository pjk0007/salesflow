import { cn } from "@/lib/utils";

interface PageContainerProps {
    children: React.ReactNode;
    className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
    return (
        <div className={cn("mx-auto max-w-7xl p-4 sm:p-6 space-y-6", className)}>
            {children}
        </div>
    );
}
