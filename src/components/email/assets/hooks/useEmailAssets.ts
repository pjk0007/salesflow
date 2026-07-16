import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { EmailAsset } from "../types";
import { uploadAsset, renameAsset, deleteAsset } from "../api/assets";

// 에셋은 org(조직) 단위. enabled=false면 조회하지 않는다(피커가 닫혀있을 때 등).
export function useEmailAssets(enabled: boolean = true) {
    const { data, error, isLoading, mutate } = useSWR(
        enabled ? "/api/email/assets" : null,
        defaultFetcher
    );

    const upload = async (file: File) => {
        const result = await uploadAsset(file);
        if (result.success) mutate();
        return result;
    };

    const rename = async (id: number, name: string) => {
        const result = await renameAsset(id, name);
        if (result.success) mutate();
        return result;
    };

    const remove = async (id: number) => {
        const result = await deleteAsset(id);
        if (result.success) mutate();
        return result;
    };

    return {
        assets: (data?.data ?? []) as EmailAsset[],
        isLoading,
        error,
        upload,
        rename,
        remove,
    };
}
