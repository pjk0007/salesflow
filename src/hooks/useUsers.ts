import useSWR from "swr";
import type { UserListItem, CreateUserInput, UpdateUserInput } from "@/types";

interface UseUsersParams {
    page?: number;
    pageSize?: number;
    search?: string;
}

interface UsersResponse {
    success: boolean;
    data: UserListItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

function buildQueryString(params: UseUsersParams): string {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.search) qs.set("search", params.search);
    return qs.toString();
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useUsers(params: UseUsersParams) {
    const queryString = buildQueryString(params);
    const key = `/api/users?${queryString}`;

    const { data, error, isLoading, mutate } = useSWR<UsersResponse>(key, fetcher);

    const createUser = async (userData: CreateUserInput) => {
        const res = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateUser = async (id: string, userData: UpdateUserInput) => {
        const res = await fetch(`/api/users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(userData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        users: data?.data ?? [],
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        pageSize: data?.pageSize ?? 20,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        mutate,
        createUser,
        updateUser,
    };
}
