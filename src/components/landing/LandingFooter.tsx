import Link from "next/link";

export default function LandingFooter() {
    return (
        <footer className="border-t py-12 px-4">
            <div className="container mx-auto">
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                    {/* Brand */}
                    <div>
                        <p className="text-lg font-bold">SalesFlow</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            스마트 영업 관리 플랫폼
                        </p>
                    </div>

                    {/* 제품 */}
                    <div>
                        <p className="font-semibold text-sm">제품</p>
                        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                            <li><a href="#features" className="hover:text-foreground transition-colors">기능</a></li>
                            <li><a href="#pricing" className="hover:text-foreground transition-colors">요금제</a></li>
                            <li><a href="#faq" className="hover:text-foreground transition-colors">FAQ</a></li>
                        </ul>
                    </div>

                    {/* 지원 */}
                    <div>
                        <p className="font-semibold text-sm">지원</p>
                        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                            <li><Link href="/contact" className="hover:text-foreground transition-colors">문의하기</Link></li>
                            <li><Link href="/terms" className="hover:text-foreground transition-colors">이용약관</Link></li>
                            <li><Link href="/privacy" className="hover:text-foreground transition-colors">개인정보처리방침</Link></li>
                        </ul>
                    </div>

                    {/* 연결 */}
                    <div>
                        <p className="font-semibold text-sm">연결</p>
                        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                            <li><span className="text-muted-foreground/50">블로그 (준비중)</span></li>
                            <li><span className="text-muted-foreground/50">GitHub (준비중)</span></li>
                        </ul>
                    </div>
                </div>

                <div className="mt-8 border-t pt-8">
                    <p className="text-center text-xs text-muted-foreground">
                        &copy; 2026 SalesFlow. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}
