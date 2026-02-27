import Link from "next/link";
import { Button } from "@/components/ui/button";
import AnimateOnScroll from "./AnimateOnScroll";

export default function CtaSection() {
    return (
        <section className="py-20 px-4">
            <div className="container mx-auto text-center">
                <AnimateOnScroll>
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                        영업 성과를 높일 준비가 되셨나요?
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">
                        지금 무료로 시작하세요. 신용카드 없이 바로 사용할 수 있습니다.
                    </p>
                    <div className="mt-8">
                        <Button size="lg" asChild>
                            <Link href="/signup">무료로 시작하기</Link>
                        </Button>
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
