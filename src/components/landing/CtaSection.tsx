import Link from "next/link";
import AnimateOnScroll from "./AnimateOnScroll";

export default function CtaSection() {
    return (
        <section className="py-20">
            <div className="max-w-7xl mx-auto px-6 md:px-12">
                <AnimateOnScroll>
                    <div className="bg-linear-to-r from-blue-600 to-violet-600 rounded-[2.5rem] p-12 md:p-20 text-center text-white relative overflow-hidden shadow-2xl">
                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 blur-[100px] -mr-48 -mt-48" />
                        <div className="relative z-10 space-y-8">
                            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">
                                지금 바로 Sendb를 시작하세요
                            </h2>
                            <p className="text-blue-100 text-lg md:text-xl max-w-2xl mx-auto">
                                불필요한 수작업은 멈추고, 더 중요한 영업에 집중하세요.
                            </p>
                            <div className="flex justify-center">
                                <Link href="/signup"
                                    className="px-10 py-5 bg-white text-blue-600 font-bold text-lg rounded-2xl shadow-xl hover:shadow-2xl hover:scale-105 transition-all inline-block">
                                    무료로 시작하기
                                </Link>
                            </div>
                        </div>
                    </div>
                </AnimateOnScroll>
            </div>
        </section>
    );
}
