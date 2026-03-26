"use client";

import { useState, type FormEvent } from "react";
import { SendbIcon } from "@/components/SendbLogo";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/contexts/SessionContext";
import { CheckCircle, Sparkles, CreditCard } from "lucide-react";

const BENEFITS = [
    { icon: CheckCircle, text: "무료 플랜으로 바로 시작" },
    { icon: Sparkles, text: "AI 기반 영업 자동화" },
    { icon: CreditCard, text: "신용카드 불필요" },
];

export default function SignupPage() {
    const router = useRouter();
    const { refreshSession } = useSession();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const res = await fetch("/api/auth/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, name }),
            });
            const data = await res.json();

            if (data.success) {
                await refreshSession();
                router.push("/onboarding");
            } else {
                setError(data.error || "회원가입에 실패했습니다.");
            }
        } catch {
            setError("서버에 연결할 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col md:flex-row bg-white antialiased">
            {/* LEFT: 브랜드 패널 */}
            <section className="hidden md:flex md:w-1/2 bg-linear-to-br from-blue-600 to-violet-600 p-12 lg:p-20 flex-col justify-between relative overflow-hidden">
                {/* 배경 장식 */}
                <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none">
                    <div className="absolute -top-24 -right-24 w-96 h-96 bg-white rounded-full blur-3xl" />
                    <div className="absolute bottom-1/4 -left-24 w-64 h-64 bg-blue-400 rounded-full blur-3xl" />
                </div>

                {/* 로고 */}
                <Link href="/" className="relative z-10 flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <SendbIcon className="size-8" />
                    <span className="text-3xl font-black text-white tracking-tighter">Sendb</span>
                </Link>

                {/* 중앙 콘텐츠 */}
                <div className="relative z-10 max-w-lg">
                    <h1 className="text-4xl lg:text-5xl font-extrabold text-white leading-tight mb-6">
                        스마트한 영업 관리를<br />시작하세요
                    </h1>
                    <p className="text-xl text-white/80 font-medium mb-12">
                        무료로 가입하고 바로 시작하세요
                    </p>
                    <ul className="space-y-6">
                        {BENEFITS.map((b) => (
                            <li key={b.text} className="flex items-center gap-4 text-white group">
                                <div className="bg-white/20 p-2 rounded-lg group-hover:bg-white/30 transition-colors">
                                    <b.icon className="h-6 w-6 text-white" />
                                </div>
                                <span className="text-lg font-medium">{b.text}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* 푸터 */}
                <div className="relative z-10">
                    <p className="text-sm text-white/60 font-medium">&copy; 2026 Sendb</p>
                </div>
            </section>

            {/* RIGHT: 회원가입 폼 */}
            <section className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 bg-white">
                {/* 모바일 로고 */}
                <div className="md:hidden mb-8 self-start">
                    <span className="text-2xl font-black bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">Sendb</span>
                </div>

                <div className="w-full max-w-md">
                    <div className="mb-10 text-center md:text-left">
                        <h2 className="text-3xl font-bold text-slate-900 mb-2">회원가입</h2>
                        <p className="text-slate-500 font-medium">Sendb 계정을 생성합니다</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <label htmlFor="name" className="block text-sm font-semibold text-slate-700 ml-1">이름</label>
                            <input
                                id="name"
                                type="text"
                                placeholder="이름을 입력하세요"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                autoFocus
                                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="email" className="block text-sm font-semibold text-slate-700 ml-1">이메일</label>
                            <input
                                id="email"
                                type="email"
                                placeholder="name@company.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="password" className="block text-sm font-semibold text-slate-700 ml-1">비밀번호</label>
                            <input
                                id="password"
                                type="password"
                                placeholder="6자 이상 입력하세요"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400"
                            />
                        </div>

                        {error && (
                            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600 text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all mt-4 disabled:opacity-50"
                        >
                            {isLoading ? "가입 중..." : "회원가입"}
                        </button>
                    </form>

                    {/* 구분선 */}
                    <div className="relative my-8">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200" />
                        </div>
                        <div className="relative flex justify-center text-sm">
                            <span className="px-4 bg-white text-slate-400 font-medium">또는</span>
                        </div>
                    </div>

                    {/* Google 로그인 */}
                    <button className="w-full flex items-center justify-center gap-3 px-4 py-3.5 border border-slate-200 rounded-xl hover:bg-slate-50 active:scale-[0.98] transition-all font-semibold text-slate-700">
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google로 계속하기
                    </button>

                    <div className="mt-10 text-center">
                        <p className="text-slate-600 font-medium">
                            이미 계정이 있으신가요?{" "}
                            <Link href="/login" className="text-blue-600 hover:text-blue-700 font-bold ml-1 transition-colors">로그인</Link>
                        </p>
                    </div>

                    <p className="mt-8 text-center text-[11px] text-slate-400 leading-relaxed px-4">
                        가입 시 <Link href="/terms" className="underline hover:text-slate-600">이용약관</Link> 및{" "}
                        <Link href="/privacy" className="underline hover:text-slate-600">개인정보처리방침</Link>에 동의합니다
                    </p>
                </div>
            </section>
        </div>
    );
}
