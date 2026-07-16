export interface EmailAsset {
    id: number;
    orgId: string;
    name: string;
    url: string;
    r2Key: string;
    contentType: string;
    size: number;
    createdAt: string;
}

// AssetPicker가 선택 결과로 반환하는 최소 형태 (id + url 둘 다 포함)
export interface SelectedAsset {
    id: number;
    url: string;
}
