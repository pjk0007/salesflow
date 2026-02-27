import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import AnimateOnScroll from "./AnimateOnScroll";

const FAQ = [
    {
        q: "SalesFlow는 무료로 사용할 수 있나요?",
        a: "네, Free 플랜으로 워크스페이스 1개, 레코드 500건, 멤버 2명까지 무료로 사용할 수 있습니다. 신용카드 등록 없이 바로 시작하세요.",
    },
    {
        q: "기존 고객 데이터를 가져올 수 있나요?",
        a: "CSV 파일로 기존 고객 데이터를 한 번에 가져올 수 있습니다. 컬럼 매핑을 지원하여 기존 데이터 구조를 그대로 활용할 수 있습니다.",
    },
    {
        q: "팀원은 몇 명까지 추가할 수 있나요?",
        a: "Free 플랜은 2명, Pro 플랜은 10명까지 지원합니다. Enterprise 플랜은 무제한으로 팀원을 추가할 수 있습니다.",
    },
    {
        q: "AI 기능은 어떤 것들이 있나요?",
        a: "이메일 자동 생성, 기업 정보 조사, 대시보드 위젯 추천, 웹폼 필드 자동 생성 등 다양한 AI 기능을 제공합니다. Pro 플랜 이상에서 사용 가능합니다.",
    },
    {
        q: "이메일 자동화는 어떻게 설정하나요?",
        a: "레코드 생성이나 상태 변경 등 조건을 설정하면, 해당 조건 충족 시 자동으로 이메일이 발송됩니다. 템플릿과 개인화 변수를 활용할 수 있습니다.",
    },
    {
        q: "알림톡 발송도 가능한가요?",
        a: "NHN Cloud 알림톡 연동을 지원합니다. 승인된 템플릿으로 고객에게 카카오 알림톡을 자동 발송할 수 있습니다.",
    },
    {
        q: "데이터는 안전하게 보호되나요?",
        a: "모든 데이터는 암호화되어 안전하게 보관됩니다. 99.9% 서비스 가동률을 보장하며, 정기적인 백업을 수행합니다.",
    },
    {
        q: "플랜을 변경하려면 어떻게 하나요?",
        a: "설정 > 결제 메뉴에서 언제든 플랜을 업그레이드하거나 변경할 수 있습니다. 업그레이드 시 즉시 적용됩니다.",
    },
];

export default function FaqSection() {
    return (
        <section id="faq" className="py-20 px-4">
            <div className="container mx-auto">
                <AnimateOnScroll>
                    <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                        자주 묻는 질문
                    </h2>
                    <p className="mt-4 text-center text-muted-foreground">
                        궁금한 점이 있으신가요?
                    </p>
                </AnimateOnScroll>

                <AnimateOnScroll className="mt-12 max-w-3xl mx-auto">
                    <Accordion type="single" collapsible>
                        {FAQ.map((item, i) => (
                            <AccordionItem key={i} value={`faq-${i}`}>
                                <AccordionTrigger className="text-left text-sm font-medium">
                                    {item.q}
                                </AccordionTrigger>
                                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                                    {item.a}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
