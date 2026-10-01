"use client";

import { Search, X, Star, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { SenderProfile } from "../types/sender-profile";
import { useSenderProfileList } from "../hooks/use-sender-profile-list";

interface SenderProfileListProps {
    profiles: SenderProfile[];
    onEdit: (profile: SenderProfile) => void;
    onDelete: (id: number) => void;
    onSetDefault: (id: number) => void;
}

export default function SenderProfileList({ profiles, onEdit, onDelete, onSetDefault }: SenderProfileListProps) {
    const { items, total, totalPages, page, query, handleSearch, handleClear, handlePrevious, handleNext } = useSenderProfileList(profiles);

    return (
        <div className="space-y-3">
            <div className="relative">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="발신자 프로필 검색" placeholder="프로필 이름, 발신 이름, 이메일로 검색"
                    value={query} onChange={handleSearch} className="pl-9 pr-10" />
                {query && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                    onClick={handleClear} aria-label="검색어 지우기"><X className="h-4 w-4" /></Button>}
            </div>
            <div className="overflow-hidden rounded-lg border">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_6.5rem] gap-4 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:grid">
                    <span>프로필</span><span>발신 이름 · 이메일</span><span className="text-right">관리</span>
                </div>
                {items.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {profiles.length === 0 ? "발신자 프로필이 없습니다. 추가 버튼을 눌러 생성하세요." : "검색 결과가 없습니다."}
                        {query && <Button variant="link" onClick={handleClear} className="block mx-auto">검색 초기화</Button>}
                    </div>
                ) : (
                    <ul className="divide-y">
                        {items.map((profile) => (
                            <li key={profile.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-4 gap-y-1 px-3 py-2 hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_6.5rem]">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-medium" title={profile.name}>{profile.name}</span>
                                    {profile.isDefault && <Badge variant="secondary" className="shrink-0 text-xs">기본</Badge>}
                                </div>
                                <div className="col-start-1 row-start-2 min-w-0 text-xs sm:col-start-2 sm:row-start-1">
                                    <p className="truncate text-muted-foreground" title={profile.fromName}>{profile.fromName}</p>
                                    <p className="truncate" title={profile.fromEmail}>{profile.fromEmail}</p>
                                </div>
                                <div className="col-start-2 row-span-2 row-start-1 flex justify-end gap-1 sm:col-start-3 sm:row-span-1">
                                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={profile.isDefault}
                                        onClick={() => onSetDefault(profile.id)} title={profile.isDefault ? "기본 발신자" : "기본으로 설정"}
                                        aria-label={`${profile.name} 기본 발신자로 설정`}>
                                        <Star className={`h-4 w-4 ${profile.isDefault ? "fill-current text-amber-500" : ""}`} />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(profile)} title="수정" aria-label={`${profile.name} 수정`}>
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(profile.id)} title="삭제" aria-label={`${profile.name} 삭제`}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span role="status">{query.trim() ? `검색 결과 ${total}개 / 전체 ${profiles.length}개` : `전체 ${total}개 · 기본 발신자 우선`}</span>
                {totalPages > 1 && <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={handlePrevious} aria-label="이전 페이지"><ChevronLeft className="h-4 w-4" /></Button>
                    <span>{page} / {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={handleNext} aria-label="다음 페이지"><ChevronRight className="h-4 w-4" /></Button>
                </div>}
            </div>
        </div>
    );
}
