import { message, Space, Input, Spin } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDeviceRes";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProdRuntimeEnv.less";

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        products: [],
        prodId: null,
        items: [] as any[],
        snapshot: "" as string,
        loading: false,
        saving: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    const loadData = (prodId: any) => {
        if (!prodId) {
            dispatch({ items: [], snapshot: "" });
            return;
        }
        dispatch({ loading: true });
        Api.get_prod_device_res({ prod_id: prodId }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const items = (res.data && res.data.items) || [];
                dispatch({ loading: false, items, snapshot: JSON.stringify(items) });
            } else {
                dispatch({ loading: false, items: [], snapshot: "" });
                message.error(res.msg);
            }
        });
    };

    const onChange = (idx: number, field: string, value: string) => {
        const items = data.items.map((it: any, i: number) =>
            i === idx ? { ...it, [field]: value } : it
        );
        dispatch({ items });
    };

    const saveAll = () => {
        if (!data.prodId) return;
        const cur = JSON.stringify(data.items);
        if (cur === data.snapshot) return;
        dispatch({ saving: true });
        Api.save_prod_device_res({ prod_id: data.prodId, items: data.items }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: cur });
                message.success(ts("msg_ok"));
            } else {
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        loadProducts();
    }, []);

    const cell = (idx: number, field: string, single?: boolean) => (
        <Input.TextArea
            className="env-input"
            autoSize={{ minRows: 1, maxRows: 6 }}
            value={data.items[idx]?.[field] ?? ""}
            disabled={!data.prodId}
            style={single ? { textAlign: "center" } : undefined}
            onChange={(e) => onChange(idx, field, e.target.value)}
            onBlur={saveAll}
            placeholder={data.prodId ? "" : "请先选择产品"}
        />
    );

    return (
        <div className="page div-v prod-runtime-env">
            <div className="div-h searchbar list-searchbar-align">
                <Space>
                    <span>{ts("srs_doc.select_product")}：</span>
                    <div style={{ minWidth: 360 }}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            value={data.prodId}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.version")}
                            onChange={(v: any) => {
                                dispatch({ prodId: v ?? null });
                                loadData(v ?? null);
                            }}
                        />
                    </div>
                </Space>
                {data.saving ? <span className="env-saving">保存中…</span> : null}
            </div>

            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">设备资源</h2>
                    <table className="env-table">
                        <colgroup>
                            <col style={{ width: 180 }} />
                            <col />
                            <col style={{ width: 90 }} />
                        </colgroup>
                        <thead>
                            <tr><th>设备及用途</th><th>设备名称</th><th>数量</th></tr>
                        </thead>
                        <tbody>
                            {data.items.map((it: any, idx: number) => (
                                <tr key={idx}>
                                    <td className="lbl">{it.use}</td>
                                    <td>{cell(idx, "name")}</td>
                                    <td>{cell(idx, "qty", true)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Spin>
        </div>
    );
};
