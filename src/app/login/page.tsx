"use client";

import { useState, type FormEvent } from "react";
import { SendbIcon } from "@/components/SendbLogo";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/contexts/SessionContext";
import { Mail, Lock } from "lucide-react";

export default function LoginPage() {
    const router = useRouter();
    const { refreshSession } = useSession();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();

            if (data.success) {
                await refreshSession();
                router.push("/");
            } else {
                setError(data.error || "로그인에 실패했습니다.");
            }
        } catch {
            setError("서버에 연결할 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen bg-white antialiased">
            {/* LEFT: 브랜드 패널 */}
            <section className="hidden lg:flex w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-[#2563eb] to-[#7c3aed] relative overflow-hidden">
                {/* 배경 장식 */}
                <div className="absolute -top-[10%] -right-[10%] w-96 h-96 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-[10%] -left-[10%] w-64 h-64 bg-[#7c3aed]/30 rounded-full blur-3xl" />

                {/* 로고 */}
                <Link href="/" className="z-10 flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <SendbIcon className="size-8" />
                    <span className="text-2xl font-black tracking-tight text-white">Sendb</span>
                </Link>

                {/* 중앙 콘텐츠 */}
                <div className="z-10 flex flex-col items-center justify-center text-center space-y-12">
                    <div className="space-y-4">
                        <h1 className="text-5xl font-extrabold text-white leading-tight tracking-tight">
                            영업 데이터를<br />하나의 화면으로
                        </h1>
                        <p className="text-white/70 text-lg font-medium">
                            고객, 레코드, 이메일을 통합 관리하세요
                        </p>
                    </div>

                    {/* 글래스모피즘 대시보드 프리뷰 */}
                    <div className="w-full max-w-md p-6 rounded-xl shadow-2xl space-y-6"
                        style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.2)" }}>
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-red-400/80" />
                                <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                                <div className="w-3 h-3 rounded-full bg-green-400/80" />
                            </div>
                            <span className="text-xs text-white/50 font-mono">DASHBOARD_V2</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/10 p-4 rounded-lg border border-white/10">
                                <p className="text-[10px] text-white/60 uppercase tracking-wider mb-1">Active Leads</p>
                                <p className="text-2xl font-bold text-white">124</p>
                            </div>
                            <div className="bg-white/10 p-4 rounded-lg border border-white/10">
                                <p className="text-[10px] text-white/60 uppercase tracking-wider mb-1">Conversion Rate</p>
                                <p className="text-2xl font-bold text-white">18.4%</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-end justify-between h-24 gap-2">
                                {[40, 65, 50, 85, 45, 95, 60].map((h, i) => (
                                    <div key={i} className="w-full rounded-t-sm" style={{ height: `${h}%`, background: `rgba(255,255,255,${0.2 + i * 0.08})` }} />
                                ))}
                            </div>
                            <div className="flex justify-between text-[8px] text-white/40 font-mono">
                                <span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 푸터 */}
                <div className="z-10">
                    <p className="text-white/60 text-xs font-medium">&copy; 2026 Sendb Inc. All rights reserved.</p>
                </div>
            </section>

            {/* RIGHT: 로그인 폼 */}
            <section className="w-full lg:w-1/2 flex flex-col items-center justify-center p-8 md:p-12 lg:p-24 bg-white">
                <div className="w-full max-w-md space-y-10">
                    {/* 모바일 로고 */}
                    <div className="lg:hidden flex items-center gap-2 mb-8">
                        <SendbIcon className="size-7" />
                        <span className="text-xl font-black tracking-tight text-[#2563eb]">Sendb</span>
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-3xl font-bold text-slate-900 tracking-tight">로그인</h2>
                        <p className="text-slate-500 font-medium">Sendb 계정으로 로그인하세요</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-1.5">
                            <label htmlFor="email" className="text-sm font-semibold text-slate-700 ml-1">이메일</label>
                            <div className="relative group">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-[#2563eb] transition-colors" />
                                <input
                                    id="email"
                                    type="email"
                                    placeholder="name@company.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all outline-none text-slate-900 placeholder:text-slate-400"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center px-1">
                                <label htmlFor="password" className="text-sm font-semibold text-slate-700">비밀번호</label>
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-[#2563eb] transition-colors" />
                                <input
                                    id="password"
                                    type="password"
                                    placeholder="비밀번호를 입력하세요"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all outline-none text-slate-900 placeholder:text-slate-400"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600 text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-[#2563eb] hover:bg-blue-700 text-white font-bold py-3.5 rounded-lg shadow-lg shadow-[#2563eb]/25 transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {isLoading ? "로그인 중..." : "로그인"}
                        </button>
                    </form>

                    {/* 구분선 */}
                    <div className="relative flex items-center py-2">
                        <div className="flex-grow border-t border-slate-200" />
                        <span className="flex-shrink mx-4 text-slate-400 text-xs font-medium uppercase tracking-wider">또는</span>
                        <div className="flex-grow border-t border-slate-200" />
                    </div>

                    {/* Google 로그인 */}
                    <button className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-lg transition-colors">
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1.01.68-2.27 1.05-3.71 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google로 계속하기
                    </button>

                    <p className="text-center text-slate-500 text-sm font-medium">
                        계정이 없으신가요?{" "}
                        <Link href="/signup" className="text-[#2563eb] hover:text-blue-700 font-bold ml-1">회원가입</Link>
                    </p>
                </div>
            </section>
        </div>
    );
}
