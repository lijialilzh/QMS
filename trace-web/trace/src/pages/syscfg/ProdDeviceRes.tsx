import { message, Space, Input, Spin } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDeviceRes";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiMember from "@/api/ApiProjectMember";
import SelectProductEmpty from "@/views/SelectProductEmpty";
import "./ProdRuntimeEnv.less";

// 软件/工具类：数量 = 设备名称按顿号/逗号拆出的项数
const NAME_QTY_USES = new Set(["操作系统", "开发语言", "数据库", "开发工具", "测试工具", "配置管理工具"]);
// 设备类：数量 = 参与人员中职能含对应关键字且有姓名的人数
const STAFF_QTY_USES: Record<string, string[]> = {
    "开发设备": ["开发"],
    "测试设备": ["测试"],
    "生产设备": ["生产"],
    "检验设备": ["检验", "QA"],
};
const countNames = (name: any) =>
    String(name ?? "").split(/[,，、]+/).map((s) => s.trim()).filter(Boolean).length;
const countStaff = (members: any[], kws: string[]) =>
    (members || []).filter((m: any) => {
        if (!String(m.name || "").trim()) return false;
        const role = String(m.role || "");
        return kws.some((kw) => role.toLowerCase().includes(kw.toLowerCase()));
    }).length;
const withAutoQty = (items: any[], members: any[]) =>
    (items || []).map((it: any) => {
        const use = String(it?.use || "").trim();
        let qty = it.qty;
        if (NAME_QTY_USES.has(use)) {
            const n = countNames(it.name);
            qty = n ? String(n) : "";
        } else if (STAFF_QTY_USES[use]) {
            qty = String(countStaff(members, STAFF_QTY_USES[use]));
        }
        return String(it.qty ?? "") === String(qty) ? it : { ...it, qty };
    });

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
        Promise.all([
            Api.get_prod_device_res({ prod_id: prodId }),
            ApiMember.list_project_member({ prod_id: prodId, page_index: 0, page_size: 1000 }).catch(() => null),
        ]).then(([res, mb]: any[]) => {
            if (res.code === Api.C_OK) {
                const raw = (res.data && res.data.items) || [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const items = withAutoQty(raw, members);
                const snapshot = JSON.stringify(raw);
                dispatch({ loading: false, items, snapshot });
                if (JSON.stringify(items) !== snapshot) {
                    Api.save_prod_device_res({ prod_id: prodId, items }).then((sv: any) => {
                        if (sv.code === Api.C_OK) dispatch({ snapshot: JSON.stringify(items) });
                    });
                }
            } else {
                dispatch({ loading: false, items: [], snapshot: "" });
                message.error(res.msg);
            }
        });
    };

    const onChange = (idx: number, field: string, value: string) => {
        const items = data.items.map((it: any, i: number) => {
            if (i !== idx) return it;
            const next = { ...it, [field]: value };
            if (field === "name" && NAME_QTY_USES.has(String(it.use || "").trim())) {
                const n = countNames(value);
                next.qty = n ? String(n) : "";
            }
            return next;
        });
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

    const cell = (idx: number, field: string, single?: boolean) => {
        const use = String(data.items[idx]?.use || "").trim();
        const autoQty = field === "qty" && (NAME_QTY_USES.has(use) || !!STAFF_QTY_USES[use]);
        return (
        <Input.TextArea
            className="env-input"
            autoSize={{ minRows: 1, maxRows: 6 }}
            value={data.items[idx]?.[field] ?? ""}
            disabled={!data.prodId || autoQty}
            style={single ? { textAlign: "center" } : undefined}
            onChange={(e) => onChange(idx, field, e.target.value)}
            onBlur={saveAll}
            placeholder={data.prodId ? "" : "请先选择产品"}
        />
        );
    };

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

            {data.prodId ? (
            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">设备资源</h2>
                    <table className="env-table">
                        <colgroup>
                            <col style={{ width: 160 }} />
                            <col />
                            <col style={{ width: 100 }} />
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
            ) : (
                <SelectProductEmpty />
            )}
        </div>
    );
};
