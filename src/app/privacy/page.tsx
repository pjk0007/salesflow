import Link from "next/link";

const SIDEBAR_ITEMS = [
    { label: "개인정보 처리방침", href: "/privacy", active: true },
    { label: "이용약관", href: "/terms", active: false },
];

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-[#f7f9fb] text-slate-900">
            {/* Nav */}
            <nav className="fixed top-0 w-full z-50 bg-white shadow-none">
                <div className="flex justify-between items-center h-16 px-8 max-w-[1440px] mx-auto">
                    <Link href="/" className="text-2xl font-black text-blue-600 tracking-tight">Sendb</Link>
                    <Link href="/" className="text-slate-500 hover:text-blue-600 transition-colors font-bold text-lg">홈으로 돌아가기</Link>
                </div>
                <div className="bg-slate-200 h-[1px] w-full" />
            </nav>

            <div className="flex max-w-[1440px] mx-auto pt-16">
                {/* Sidebar */}
                <aside className="w-72 h-[calc(100vh-64px)] sticky top-16 bg-slate-100 hidden md:flex flex-col py-6 shrink-0">
                    <div className="px-6 mb-8">
                        <h2 className="font-bold text-xl mb-1">법적 고지 센터</h2>
                        <p className="text-slate-500 text-xs">Sendb의 법적 정책을 확인하세요</p>
                    </div>
                    <nav className="flex flex-col gap-1">
                        {SIDEBAR_ITEMS.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={
                                    item.active
                                        ? "bg-white text-blue-600 font-semibold rounded-lg mx-2 my-1 px-4 py-3 flex items-center gap-3 text-sm"
                                        : "text-slate-500 hover:bg-white/50 mx-2 my-1 px-4 py-3 flex items-center gap-3 text-sm"
                                }
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="flex-1 px-8 md:px-16 py-12 bg-[#f7f9fb]">
                    <header className="mb-12">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold mb-4">
                            Policy Update
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-4">개인정보 처리방침</h1>
                        <p className="text-slate-500 font-medium">최종 업데이트일: 2026년 3월 26일</p>
                    </header>

                    <div className="space-y-16 max-w-4xl">
                        {/* Section 1 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">1</span>
                                개인정보의 수집 및 이용 목적
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 leading-relaxed text-slate-600">
                                <p className="mb-4">Sendb는 수집한 개인정보를 다음의 목적을 위해 활용합니다. 이용자가 제공한 모든 정보는 다음에 기술된 목적 이외의 용도로는 사용되지 않으며, 이용 목적이 변경될 시에는 사전 동의를 구할 예정입니다.</p>
                                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                                    <li className="flex items-start gap-3 p-4 rounded-lg bg-slate-50">
                                        <div>
                                            <span className="font-bold text-slate-900 block mb-1">서비스 회원 가입 및 관리</span>
                                            <span className="text-sm">회원 가입 의사 확인, 본인 식별 및 인증, 회원자격 유지 및 관리</span>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-3 p-4 rounded-lg bg-slate-50">
                                        <div>
                                            <span className="font-bold text-slate-900 block mb-1">재화 또는 서비스 제공</span>
                                            <span className="text-sm">계약서 발급, 물품 배송, 서비스 제공, 콘텐츠 제공, 요금 결제 및 정산</span>
                                        </div>
                                    </li>
                                </ul>
                            </div>
                        </article>

                        {/* Section 2 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">2</span>
                                수집하는 개인정보 항목
                            </h2>
                            <div className="overflow-hidden rounded-xl border border-slate-200">
                                <table className="w-full text-left border-collapse bg-white">
                                    <thead>
                                        <tr className="bg-slate-50">
                                            <th className="p-4 font-bold text-slate-900 border-b border-slate-200">구분</th>
                                            <th className="p-4 font-bold text-slate-900 border-b border-slate-200">수집 항목</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-sm">
                                        <tr>
                                            <td className="p-4 border-b border-slate-100 font-semibold bg-slate-50/50">필수 항목</td>
                                            <td className="p-4 border-b border-slate-100 text-slate-600">성명, 아이디, 비밀번호, 이메일 주소, 휴대전화 번호, 회사명</td>
                                        </tr>
                                        <tr>
                                            <td className="p-4 border-b border-slate-100 font-semibold bg-slate-50/50">자동 수집 항목</td>
                                            <td className="p-4 border-b border-slate-100 text-slate-600">IP 주소, 쿠키, 방문 일시, 서비스 이용 기록, 기기 정보</td>
                                        </tr>
                                        <tr>
                                            <td className="p-4 font-semibold bg-slate-50/50">유료 서비스 이용 시</td>
                                            <td className="p-4 text-slate-600">결제 정보(카드번호, 은행 계좌정보 등), 사업자 등록번호</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </article>

                        {/* Section 3 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">3</span>
                                개인정보의 보유 및 이용 기간
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
                                <p className="text-slate-600 leading-relaxed mb-6">
                                    이용자의 개인정보는 원칙적으로 개인정보의 수집 및 이용 목적이 달성되면 지체 없이 파기합니다. 단, 다음의 정보에 대해서는 아래의 이유로 명시한 기간 동안 보존합니다.
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { label: "계약 취소 등 기록", period: "5년" },
                                        { label: "대금 결제 기록", period: "5년" },
                                        { label: "소비자 불만 기록", period: "3년" },
                                        { label: "로그인 기록", period: "3개월" },
                                    ].map((item) => (
                                        <div key={item.label} className="p-4 bg-slate-50 rounded-lg text-center">
                                            <div className="text-xs text-slate-500 mb-1">{item.label}</div>
                                            <div className="font-bold text-slate-900">{item.period}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </article>

                        {/* Section 4 & 5 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <article className="bg-white p-8 rounded-xl border border-slate-200">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">4. 제3자 제공</h3>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    Sendb는 이용자의 동의 없이 개인정보를 외부에 제공하지 않습니다. 단, 법령의 규정에 의하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우를 제외합니다.
                                </p>
                            </article>
                            <article className="bg-white p-8 rounded-xl border border-slate-200">
                                <h3 className="text-xl font-bold text-slate-900 mb-4">5. 처리 위탁</h3>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    회사는 서비스 향상을 위해 개인정보 처리를 외부 전문업체에 위탁할 수 있으며, 위탁 계약 시 개인정보보호 관련 법규의 준수, 개인정보에 관한 비밀 유지, 제3자 제공 금지 등을 명확히 규정하고 있습니다. 위탁업체가 변경될 경우 본 방침을 통해 공지합니다.
                                </p>
                            </article>
                        </div>

                        {/* Section 6 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">6</span>
                                개인정보의 파기
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-slate-600 leading-relaxed">
                                <p className="mb-4">회사는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.</p>
                                <ul className="list-disc ml-6 space-y-2">
                                    <li>전자적 파일 형태의 정보는 복구 및 재생할 수 없도록 안전하게 삭제합니다.</li>
                                    <li>종이에 출력된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.</li>
                                </ul>
                            </div>
                        </article>

                        {/* Section 7 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">7</span>
                                이용자의 권리와 행사 방법
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-slate-600 leading-relaxed">
                                <p>이용자는 언제든지 자신의 개인정보에 대해 열람, 수정, 삭제, 처리정지를 요구할 수 있습니다. 이는 서비스 내 설정 페이지를 통해 직접 처리하거나, 고객지원팀(support@sendb.com)으로 요청할 수 있습니다.</p>
                            </div>
                        </article>

                        {/* Section 8 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">8</span>
                                쿠키의 운용 및 거부
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-slate-600 leading-relaxed">
                                <p className="mb-4">회사는 이용자에게 개별적인 맞춤서비스를 제공하기 위해 이용 정보를 저장하고 수시로 불러오는 &apos;쿠키(cookie)&apos;를 사용합니다.</p>
                                <p>이용자는 쿠키 설치에 대한 선택권을 가지고 있으며, 웹 브라우저 설정을 통해 쿠키를 허용하거나 거부할 수 있습니다. 다만, 쿠키 저장을 거부할 경우 맞춤형 서비스 이용에 어려움이 발생할 수 있습니다.</p>
                            </div>
                        </article>

                        {/* Section 9 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">9</span>
                                개인정보 보호책임자
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-slate-600 leading-relaxed">
                                <p className="mb-4">회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 이용자의 불만처리 및 피해구제를 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.</p>
                                <div className="p-4 bg-slate-50 rounded-lg">
                                    <p className="font-semibold text-slate-900">개인정보 보호책임자</p>
                                    <p className="text-sm mt-1">이메일: support@sendb.com</p>
                                </div>
                            </div>
                        </article>

                        {/* Section 10 */}
                        <article>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                                <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm">10</span>
                                개인정보 처리방침 변경
                            </h2>
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-slate-600 leading-relaxed">
                                <p>본 개인정보 처리방침은 법령, 정책 또는 보안기술의 변경에 따라 내용의 추가, 삭제 및 수정이 있을 시에는 변경사항의 시행 7일 전부터 서비스 내 공지사항을 통하여 고지할 것입니다.</p>
                            </div>
                        </article>

                        {/* CTA */}
                        <section className="bg-blue-600 text-white p-12 rounded-3xl relative overflow-hidden">
                            <div className="relative z-10">
                                <h2 className="text-3xl font-black mb-4">도움이 필요하신가요?</h2>
                                <p className="text-blue-200 mb-8 max-w-lg">개인정보 처리방침과 관련하여 궁금한 점이 있으시거나 권리 행사가 필요하신 경우, Sendb 고객센터로 문의해 주세요.</p>
                                <div className="flex flex-wrap gap-4">
                                    <a href="mailto:support@sendb.com" className="bg-white text-blue-600 px-8 py-3 rounded-full font-bold hover:bg-opacity-90 transition-all">
                                        고객센터 연결하기
                                    </a>
                                </div>
                            </div>
                            <div className="absolute right-0 top-0 w-64 h-64 bg-blue-500/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                        </section>
                    </div>
                </main>
            </div>

            {/* Footer */}
            <footer className="bg-[#f7f9fb] w-full py-12 px-8 border-t border-slate-200">
                <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="text-lg font-bold text-slate-500">Sendb</div>
                    <div className="flex gap-6">
                        <Link href="/terms" className="text-slate-500 hover:text-blue-600 transition-colors text-xs font-medium">이용약관</Link>
                        <span className="text-blue-600 underline text-xs font-medium">개인정보처리방침</span>
                    </div>
                    <div className="text-slate-500 text-xs">&copy; 2026 Sendb Inc. All rights reserved.</div>
                </div>
            </footer>
        </div>
    );
}
