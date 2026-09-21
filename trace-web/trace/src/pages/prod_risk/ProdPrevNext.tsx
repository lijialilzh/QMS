import { Button, Space } from "antd";

export default ({
    products,
    prodId,
    onChange,
}: {
    products: any[];
    prodId: number;
    onChange: (id: number) => void;
}) => {
    const ids = (products || []).map((row: any) => Number(row.id)).filter(Boolean);
    const idx = ids.indexOf(Number(prodId));
    const prevId = idx > 0 ? ids[idx - 1] : undefined;
    const nextId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : undefined;
    return (
        <Space size={4}>
            <Button disabled={!prevId} onClick={() => prevId && onChange(prevId)}>
                上一个
            </Button>
            <Button disabled={!nextId} onClick={() => nextId && onChange(nextId)}>
                下一个
            </Button>
        </Space>
    );
};
