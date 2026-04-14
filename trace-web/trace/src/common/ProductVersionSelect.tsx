import { Select } from "antd";
import { useEffect, useMemo, useState } from "react";

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
}: Props) {
    const [selectedName, setSelectedName] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!value) {
            setSelectedName(undefined);
            return;
        }
        const hit = products.find((p) => p.id === value);
        setSelectedName(hit?.name);
    }, [value, products]);

    const nameOptions = useMemo(() => {
        const dedup = new Set<string>();
        products.forEach((p) => dedup.add(p.name));
        return Array.from(dedup).map((name) => ({ label: name, value: name }));
    }, [products]);

    const versionOptions = useMemo(() => {
        if (!selectedName) return [];
        return products
            .filter((p) => p.name === selectedName)
            .map((p) => ({
                label: p.full_version,
                value: p.id,
            }));
    }, [selectedName, products]);

    return (
        <div className="product-version-select" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Select
                style={{ minWidth: 180, width: 180 }}
                allowClear={allowClear}
                showSearch
                optionFilterProp="label"
                placeholder={namePlaceholder}
                disabled={disabled}
                value={selectedName}
                options={nameOptions}
                onChange={(name) => {
                    setSelectedName(name);
                    onNameChange?.(name);
                    if (!name) {
                        onChange?.(undefined);
                    } else {
                        const first = products.find((p) => p.name === name);
                        onChange?.(first?.id);
                    }
                }}
            />
            <Select
                style={{ minWidth: 180, width: 180 }}
                allowClear={allowClear}
                showSearch
                optionFilterProp="label"
                placeholder={versionPlaceholder}
                disabled={disabled || !selectedName}
                value={value}
                options={versionOptions}
                onChange={(v) => onChange?.(v)}
            />
        </div>
    );
}
