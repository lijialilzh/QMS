import { Select } from "antd";
import { useEffect, useMemo, useState } from "react";

const ALL_VALUE = "__ALL__";

type ProductItem = {
    id: number;
    name: string;
    full_version: string;
};

type Props = {
    products: ProductItem[];
    value?: number;
    onChange?: (value?: number) => void;
    disabled?: boolean;
    allowClear?: boolean;
    onNameChange?: (name?: string) => void;
    namePlaceholder?: string;
    versionPlaceholder?: string;
    /** 为 true 时，仅在选择完整版本后触发 onChange */
    deferChangeUntilVersionSelect?: boolean;
    /** 打开时默认选中的产品名称（value 为空时生效） */
    initialName?: string;
    /** 版本下拉中排除的产品 ID（如复制时排除源版本） */
    excludeProductId?: number;
    /** 版本下拉中排除的多个产品 ID（如已有 DHF 的产品） */
    excludeProductIds?: number[];
    /** 筛选栏：名称/版本增加「全部」，空值时默认全部产品 */
    includeAll?: boolean;
};

export default function ProductVersionSelect({
    products,
    value,
    onChange,
    disabled,
    allowClear = true,
    onNameChange,
    namePlaceholder = "请选择产品名称",
    versionPlaceholder = "请选择完整版本",
    deferChangeUntilVersionSelect = false,
    initialName,
    excludeProductId,
    excludeProductIds,
    includeAll = false,
}: Props) {
    const blockedProductIds = useMemo(() => {
        const ids = new Set<number>();
        (excludeProductIds || []).forEach((id) => {
            if (id) ids.add(Number(id));
        });
        if (excludeProductId) ids.add(Number(excludeProductId));
        return ids;
    }, [excludeProductId, excludeProductIds]);
    const [selectedName, setSelectedName] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (value) {
            const hit = products.find((p) => p.id === value);
            setSelectedName(hit?.name);
            return;
        }
        if (initialName) {
            setSelectedName(initialName);
            return;
        }
        if (includeAll) {
            setSelectedName((prev) => (prev && prev !== ALL_VALUE ? prev : ALL_VALUE));
            return;
        }
        setSelectedName(undefined);
    }, [value, products, initialName, includeAll]);

    const isAll = includeAll && (!selectedName || selectedName === ALL_VALUE);

    const nameOptions = useMemo(() => {
        const dedup = new Set<string>();
        products.forEach((p) => dedup.add(p.name));
        const opts = Array.from(dedup).map((name) => ({ label: name, value: name }));
        return includeAll ? [{ label: "全部", value: ALL_VALUE }, ...opts] : opts;
    }, [products, includeAll]);

    const versionOptions = useMemo(() => {
        if (isAll) return [{ label: "全部", value: ALL_VALUE }];
        if (!selectedName) return [];
        return products
            .filter((p) => p.name === selectedName && !blockedProductIds.has(p.id))
            .map((p) => ({
                label: p.full_version,
                value: p.id,
            }));
    }, [selectedName, products, blockedProductIds, isAll]);
    const displayVersionValue = isAll
        ? ALL_VALUE
        : versionOptions.some((option) => option.value === value) ? value : undefined;

    return (
        <div className="product-version-select" style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
            <Select
                style={{ flex: 1, minWidth: 0 }}
                allowClear={allowClear && !includeAll}
                showSearch
                optionFilterProp="label"
                placeholder={namePlaceholder}
                disabled={disabled}
                value={isAll ? ALL_VALUE : selectedName}
                options={nameOptions}
                onChange={(name) => {
                    if (!name || name === ALL_VALUE) {
                        setSelectedName(includeAll ? ALL_VALUE : undefined);
                        onNameChange?.(undefined);
                        onChange?.(undefined);
                        return;
                    }
                    setSelectedName(name);
                    onNameChange?.(name);
                    if (!deferChangeUntilVersionSelect) {
                        const first = products.find((p) => p.name === name);
                        onChange?.(first?.id);
                    }
                }}
            />
            <Select
                style={{ flex: 1, minWidth: 0 }}
                allowClear={allowClear && !isAll}
                showSearch
                optionFilterProp="label"
                placeholder={versionPlaceholder}
                disabled={disabled || isAll || !selectedName}
                value={displayVersionValue}
                options={versionOptions}
                onChange={(v) => {
                    if (v === ALL_VALUE || v == null) onChange?.(undefined);
                    else onChange?.(v as number);
                }}
            />
        </div>
    );
}
