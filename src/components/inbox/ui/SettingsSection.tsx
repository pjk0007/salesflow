/** 상담 설정 오른쪽 본문 — 제목·설명 + 내용 (패널·모달 없이 페이지 안에 펼친다) */
export function SettingsSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-5">
            <header>
                <h2 className="text-lg font-semibold">{title}</h2>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </header>
            {children}
        </section>
    );
}
