"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import AnimateOnScroll from "./AnimateOnScroll";

const FAQ = [
    {
        q: "Sendb는 무료로 사용할 수 있나요?",
        a: "네, Free 플랜으로 워크스페이스 1개, 레코드 500건, 멤버 2명까지 무료로 사용할 수 있습니다. 신용카드 등록 없이 바로 시작하세요.",
    },
    {
        q: "기존 고객 데이터를 가져올 수 있나요?",
        a: "CSV 파일로 기존 고객 데이터를 한 번에 가져올 수 있습니다. 컬럼 매핑을 지원하여 기존 데이터 구조를 그대로 활용할 수 있습니다.",
    },
    {
        q: "도입 시 팀원 교육이 따로 필요한가요?",
        a: "Sendb는 직관적인 UI를 제공하여 별도의 복잡한 교육 없이도 하루 만에 적응이 가능합니다. 초기에 무료 온보딩 가이드를 제공해 드립니다.",
    },
    {
        q: "데이터 보안은 안전한가요?",
        a: "모든 데이터는 암호화되어 안전하게 보관됩니다. 클라우드 환경에서 운영되며, 정기적인 백업을 수행합니다.",
    },
    {
        q: "AI 기능은 어떤 것들이 있나요?",
        a: "이메일 자동 생성, 기업 정보 조사, 대시보드 위젯 추천, 웹폼 필드 자동 생성 등 다양한 AI 기능을 제공합니다. Pro 플랜 이상에서 사용 가능합니다.",
    },
    {
        q: "플랜을 변경하려면 어떻게 하나요?",
        a: "설정 > 결제 메뉴에서 언제든 플랜을 업그레이드하거나 변경할 수 있습니다. 업그레이드 시 즉시 적용됩니다.",
    },
];

function FaqItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-slate-200 rounded-xl p-6 hover:bg-slate-50 transition-colors cursor-pointer group"
            onClick={() => setOpen(!open)}>
            <div className="flex justify-between items-center">
                <h4 className="font-bold text-slate-900">{q}</h4>
                <ChevronDown className={`h-5 w-5 text-slate-400 group-hover:text-blue-600 transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
            {open && (
                <p className="mt-4 text-slate-600 leading-relaxed text-sm">{a}</p>
            )}
        </div>
    );
}

export default function FaqSection() {
    return (
        <section id="faq" className="py-24 bg-white">
            <div className="max-w-4xl mx-auto px-6">
                <AnimateOnScroll>
                    <h2 className="text-3xl font-bold text-center mb-12">자주 묻는 질문</h2>
                </AnimateOnScroll>
                <AnimateOnScroll>
                    <div className="space-y-4">
                        {FAQ.map((item, i) => (
                            <FaqItem key={i} q={item.q} a={item.a} />
                        ))}
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
