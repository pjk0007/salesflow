import Link from "next/link";

export default function LandingFooter() {
    return (
        <footer className="bg-slate-50 w-full py-12 px-6 md:px-12 border-t border-slate-200">
            <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-12">
                <div className="col-span-2 md:col-span-1 space-y-4">
                    <div className="text-lg font-bold text-slate-900">Sendb</div>
                    <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                        영업 생산성을 극대화하는 차세대 B2B 영업 자동화 플랫폼.
                    </p>
                </div>
                <div>
                    <h5 className="font-bold text-slate-900 mb-4">제품 소개</h5>
                    <ul className="space-y-2">
                        <li><a href="#features" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">기능</a></li>
                        <li><a href="#pricing" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">요금제</a></li>
                        <li><a href="#faq" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">FAQ</a></li>
                    </ul>
                </div>
                <div>
                    <h5 className="font-bold text-slate-900 mb-4">고객지원</h5>
                    <ul className="space-y-2">
                        <li><Link href="/contact" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">문의하기</Link></li>
                    </ul>
                </div>
                <div>
                    <h5 className="font-bold text-slate-900 mb-4">법적 고지</h5>
                    <ul className="space-y-2">
                        <li><Link href="/terms" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">이용약관</Link></li>
                        <li><Link href="/privacy" className="text-sm text-slate-500 hover:text-blue-600 transition-colors">개인정보처리방침</Link></li>
                    </ul>
                </div>
            </div>
            <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-slate-200">
                <p className="text-sm text-slate-500">&copy; 2026 Sendb Inc. All rights reserved.</p>
            </div>
        </footer>
    );
}
