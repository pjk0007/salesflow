interface PageHeaderProps {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    children?: React.ReactNode;
}

export function PageHeader({
    title,
    description,
    actions,
    children,
}: PageHeaderProps) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                {description && (
                    <p className="text-muted-foreground">{description}</p>
                )}
            </div>
            {actions && (
                <div className="flex items-center gap-2 shrink-0">
                    {actions}
                </div>
            )}
            {children}
        </div>
    );
}
