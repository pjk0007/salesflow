import Link from "next/link";

const TOC = [
    { id: "section-1", icon: "1", label: "제 1 조 목적" },
    { id: "section-2", icon: "2", label: "제 2 조 정의" },
    { id: "section-3", icon: "3", label: "제 3 조 서비스 이용" },
    { id: "section-4", icon: "4", label: "제 4 조 회원가입 및 계정" },
    { id: "section-5", icon: "5", label: "제 5 조 서비스 제공 및 변경" },
    { id: "section-6", icon: "6", label: "제 6 조 요금 및 결제" },
    { id: "section-7", icon: "7", label: "제 7 조 이용자의 의무" },
    { id: "section-8", icon: "8", label: "제 8 조 서비스 이용 제한" },
    { id: "section-9", icon: "9", label: "제 9 조 개인정보보호" },
    { id: "section-10", icon: "10", label: "제 10 조 지식재산권" },
    { id: "section-11", icon: "11", label: "제 11 조 면책조항" },
    { id: "section-12", icon: "12", label: "제 12 조 약관의 변경" },
    { id: "section-13", icon: "13", label: "제 13 조 분쟁해결" },
];

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-[#f7f9fb] text-slate-900">
            {/* Nav */}
            <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md shadow-sm h-16 flex items-center justify-center">
                <div className="flex justify-between items-center px-4 md:px-8 h-16 w-full max-w-7xl">
                    <Link href="/" className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Sendb</Link>
                    <Link href="/" className="text-blue-700 font-semibold hover:text-blue-600 transition-colors text-sm md:text-base">홈으로 돌아가기</Link>
                </div>
            </nav>

            {/* Main */}
            <main className="pt-20 md:pt-24 pb-12 md:pb-20 px-4 md:px-6 max-w-[1280px] mx-auto min-h-screen">
                <header className="mb-8 md:mb-16 text-center md:text-left">
                    <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-2 md:mb-4">이용약관</h1>
                    <p className="text-slate-500 text-sm md:text-lg">최종 업데이트: 2026년 3월 26일</p>
                </header>

                <div className="flex flex-col md:flex-row gap-6 md:gap-12">
                    {/* Sidebar TOC */}
                    <aside className="hidden md:block sticky top-24 self-start w-64 shrink-0">
                        <div className="bg-slate-50 flex flex-col p-4 rounded-xl">
                            <div className="mb-3 px-2">
                                <h2 className="text-sm font-bold text-slate-900">약관 및 정책</h2>
                                <p className="text-xs text-slate-400">Sendb 법적 고지</p>
                            </div>
                            <nav className="space-y-0.5">
                                {TOC.map((item) => (
                                    <a
                                        key={item.id}
                                        href={`#${item.id}`}
                                        className="flex items-center gap-2 px-2 py-1.5 text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 transition-all duration-200 text-xs rounded-md"
                                    >
                                        <span className="w-5 h-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold shrink-0">{item.icon}</span>
                                        <span>{item.label}</span>
                                    </a>
                                ))}
                            </nav>
                        </div>
                    </aside>

                    {/* Content */}
                    <div className="flex-1 space-y-10 md:space-y-16 max-w-4xl">
                        {/* Section 1 */}
                        <section className="scroll-mt-24" id="section-1">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 1 조 (목적)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                본 약관은 &apos;Sendb&apos;(이하 &quot;회사&quot;)가 제공하는 B2B 세일즈 자동화 솔루션 및 관련 제반 서비스(이하 &quot;서비스&quot;)를 이용함에 있어 회사와 이용자의 권리, 의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.
                            </p>
                        </section>

                        {/* Section 2 */}
                        <section className="scroll-mt-24" id="section-2">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 2 조 (정의)</h3>
                            <div className="space-y-4 text-slate-600 leading-relaxed">
                                {[
                                    "\"서비스\"라 함은 구현되는 단말기(PC, 휴대형 단말기 등의 각종 유무선 장치)와 상관없이 \"이용자\"가 이용할 수 있는 Sendb 플랫폼 및 관련 제반 서비스를 의미합니다.",
                                    "\"이용자\"란 본 약관에 따라 회사가 제공하는 서비스를 이용하는 회원 및 비회원을 말합니다.",
                                    "\"회원\"이라 함은 회사의 \"서비스\"에 접속하여 이 약관에 따라 \"회사\"와 이용계약을 체결하고 \"회사\"가 제공하는 \"서비스\"를 이용하는 고객을 말합니다.",
                                ].map((text, i) => (
                                    <div key={i} className="flex gap-4 items-start p-4 bg-slate-50 rounded-lg">
                                        <span className="font-bold text-blue-600">{i + 1}.</span>
                                        <p>{text}</p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Section 3 */}
                        <section className="scroll-mt-24" id="section-3">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 3 조 (서비스 이용)</h3>
                            <p className="text-slate-600 leading-relaxed mb-6">
                                회사는 이용자에게 세일즈 자동화, 데이터 분석, 계약 관리 등의 기능을 제공합니다. 이용자는 회사가 정한 절차에 따라 서비스를 이용하며, 시스템의 안정성을 해치는 행위는 금지됩니다.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-6 border border-slate-200 rounded-xl bg-white">
                                    <h4 className="font-bold mb-2">이용 시간</h4>
                                    <p className="text-sm text-slate-500">서비스는 연중무휴 24시간 제공을 원칙으로 하되, 시스템 점검 시 사전에 공지합니다.</p>
                                </div>
                                <div className="p-6 border border-slate-200 rounded-xl bg-white">
                                    <h4 className="font-bold mb-2">업데이트</h4>
                                    <p className="text-sm text-slate-500">기능 개선 및 보안 강화를 위한 업데이트는 수시로 진행될 수 있습니다.</p>
                                </div>
                            </div>
                        </section>

                        {/* Section 4 */}
                        <section className="scroll-mt-24" id="section-4">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 4 조 (회원가입 및 계정)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                이용자는 회사가 정한 가입 양식에 따라 회원정보를 기입한 후 이 약관에 동의한다는 의사표시를 함으로써 회원가입을 신청합니다. 회사는 다음 각 호에 해당하지 않는 한 회원으로 등록합니다.
                            </p>
                            <ul className="list-disc ml-6 mt-4 space-y-2 text-slate-600">
                                <li>등록 내용에 허위, 기재누락, 오기가 있는 경우</li>
                                <li>타인의 명의를 사용하여 신청한 경우</li>
                                <li>기존에 회원자격을 상실한 적이 있는 경우</li>
                            </ul>
                        </section>

                        {/* Section 5 */}
                        <section className="scroll-mt-24" id="section-5">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 5 조 (서비스 제공 및 변경)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                회사는 이용자에게 아래와 같은 서비스를 제공합니다. 서비스의 내용은 회사의 사정에 따라 변경될 수 있으며, 변경 시 사전에 공지합니다.
                            </p>
                            <ul className="list-disc ml-6 mt-4 space-y-2 text-slate-600">
                                <li>B2B 세일즈 자동화 및 고객 관리 기능</li>
                                <li>이메일 및 알림톡 자동 발송 서비스</li>
                                <li>AI 기반 영업 어시스턴트 서비스</li>
                                <li>데이터 분석 및 대시보드 서비스</li>
                            </ul>
                        </section>

                        {/* Section 6 */}
                        <section className="scroll-mt-24" id="section-6">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 6 조 (요금 및 결제)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                서비스 이용 요금은 회사가 별도로 정하는 바에 따릅니다. 유료 서비스의 이용 요금, 결제 방법 등은 해당 서비스 페이지에 게시합니다. 이용자는 회사가 정한 결제 수단을 통해 요금을 납부해야 하며, 결제 후 환불은 관련 법령 및 회사 정책에 따릅니다.
                            </p>
                        </section>

                        {/* Section 7 & 9 Bento Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="md:col-span-2 bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-100" id="section-7">
                                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                    이용자의 핵심 의무
                                </h3>
                                <p className="text-slate-500 text-sm leading-relaxed">
                                    회원은 아이디와 비밀번호를 관리할 책임이 있으며, 타인에게 양도하거나 대여할 수 없습니다. 또한 서비스 이용 과정에서 선량한 관리자로서의 주의 의무를 다해야 하며, 부정한 방법으로 시스템에 접근하여 데이터를 조작하거나 탈취하는 행위를 엄격히 금지합니다.
                                </p>
                            </div>
                            <div className="bg-blue-50 p-5 md:p-8 rounded-2xl border border-blue-100" id="section-9">
                                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                                    개인정보보호
                                </h3>
                                <p className="text-slate-500 text-sm leading-relaxed">
                                    회사는 관련 법령이 정하는 바에 따라 회원의 개인정보를 보호하기 위해 노력하며, 별도의 <Link href="/privacy" className="text-blue-600 underline">개인정보 처리방침</Link>을 통해 구체적인 운영 계획을 고지합니다.
                                </p>
                            </div>
                        </div>

                        {/* Section 8 */}
                        <section className="scroll-mt-24" id="section-8">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 8 조 (서비스 이용 제한)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                회사는 이용자가 본 약관의 의무를 위반하거나 서비스의 정상적인 운영을 방해한 경우, 경고, 일시정지, 영구이용정지 등으로 서비스 이용을 단계적으로 제한할 수 있습니다. 이용 제한의 구체적인 기준은 회사의 운영 정책에 따릅니다.
                            </p>
                        </section>

                        {/* Section 10 */}
                        <section className="scroll-mt-24" id="section-10">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 10 조 (지식재산권)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                서비스에 대한 저작권 및 지식재산권은 회사에 귀속됩니다. 이용자는 서비스를 이용함으로써 얻은 정보를 회사의 사전 승낙 없이 복제, 송신, 출판, 배포, 방송 기타 방법에 의하여 영리 목적으로 이용하거나 제3자에게 이용하게 하여서는 안 됩니다.
                            </p>
                        </section>

                        {/* Section 11 */}
                        <section className="scroll-mt-24" id="section-11">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 11 조 (면책조항)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                회사는 천재지변, 전쟁, 국가 비상사태 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 관한 책임이 면제됩니다. 또한 이용자의 귀책사유로 인한 서비스 이용의 장애에 대하여는 책임을 지지 않습니다.
                            </p>
                        </section>

                        {/* Section 12 */}
                        <section className="scroll-mt-24" id="section-12">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 12 조 (약관의 변경)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                회사는 필요하다고 인정되는 경우 본 약관을 변경할 수 있으며, 변경된 약관은 적용일자 및 변경사유를 명시하여 서비스 내에 그 적용일자 7일 이전부터 공지합니다. 이용자에게 불리한 약관의 변경은 30일 전에 공지합니다.
                            </p>
                        </section>

                        {/* Section 13 */}
                        <section className="scroll-mt-24" id="section-13">
                            <h3 className="text-xl md:text-2xl font-bold text-slate-900 mb-4 md:mb-6">제 13 조 (분쟁해결)</h3>
                            <p className="text-slate-600 leading-relaxed">
                                회사와 이용자 간에 발생한 서비스 이용에 관한 분쟁은 상호 간의 원만한 합의를 위해 최선을 다합니다. 만약 합의가 이루어지지 않을 경우, 대한민국 법률에 따라 회사의 본사 소재지를 관할하는 법원을 전용 관할 법원으로 합니다.
                            </p>
                        </section>

                        {/* Contact */}
                        <div className="pt-8 border-t border-slate-200 text-center md:text-left">
                            <p className="text-slate-500 text-sm mb-4">본 약관에 대해 궁금한 점이 있으신가요?</p>
                            <a className="inline-flex items-center gap-2 text-blue-600 font-bold hover:underline" href="mailto:support@sendb.com">
                                고객지원팀에 문의하기
                            </a>
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-slate-100">
                <div className="flex flex-col md:flex-row justify-between items-center px-4 md:px-8 py-8 md:py-12 w-full max-w-7xl mx-auto">
                    <div className="mb-6 md:mb-0">
                        <span className="text-sm font-bold text-slate-900">Sendb</span>
                        <p className="text-slate-500 mt-2 text-xs">&copy; 2026 Sendb. All rights reserved.</p>
                    </div>
                    <div className="flex gap-6">
                        <span className="text-slate-900 underline text-xs font-medium">이용약관</span>
                        <Link href="/privacy" className="text-slate-500 hover:text-slate-800 text-xs font-medium">개인정보처리방침</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
