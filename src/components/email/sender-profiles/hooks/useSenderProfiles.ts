"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ApiResult, SenderProfile, SenderProfileCreate, SenderProfileUpdate } from "../types";
import {
    SENDER_PROFILES_KEY,
    SENDER_USAGE_KEY,
    createSenderProfile,
    deleteSenderProfile,
    updateSenderProfile,
} from "../api/senderProfiles";

export function useSenderProfiles() {
    const { data, error, isLoading, mutate } = useSWR<ApiResult<SenderProfile[]>>(
        SENDER_PROFILES_KEY,
        defaultFetcher
    );

    // 한도를 바꾸면 오늘 한도·웜업 날수도 바뀌므로 사용량도 다시 읽는다
    const refresh = () => {
        mutate();
        globalMutate(SENDER_USAGE_KEY);
    };

    const createProfile = async (input: SenderProfileCreate) => {
        const result = await createSenderProfile(input);
        if (result.success) refresh();
        return result;
    };

    const updateProfile = async (id: number, patch: SenderProfileUpdate) => {
        const result = await updateSenderProfile(id, patch);
        if (result.success) refresh();
        return result;
    };

    const deleteProfile = async (id: number) => {
        const result = await deleteSenderProfile(id);
        if (result.success) refresh();
        return result;
    };

    const profiles = data?.data ?? [];

    return {
        profiles,
        // 목록을 못 읽은 것과 "프로필이 없음"을 가른다 — 못 읽었을 때 고른 id를 "삭제됨"으로 보이지 않게
        loadFailed: !!error || (data !== undefined && !data.success),
        // 화면 기본 선택용. 서버 발송(pickSender)은 기본 표시가 없으면 아무 프로필이나 고르지 않는다
        defaultProfile: profiles.find((p) => p.isDefault) ?? profiles[0] ?? null,
        isLoading,
        error,
        mutate,
        createProfile,
        updateProfile,
        deleteProfile,
    };
}
