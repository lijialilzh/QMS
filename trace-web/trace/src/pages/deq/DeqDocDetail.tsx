import { Button, Input, Space, Spin, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiDeqDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 6px", fontSize: 13, verticalAlign: "middle" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", textAlign: "center" };

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        content: { rows: [] } as any,
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_deq_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            dispatch({ loading: false, doc, content: doc.content || { rows: [] } });
        });
    };

    useEffect(() => {
        load();
    }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
    };

    const rows: any[][] = Array.isArray(data.content?.rows) ? data.content.rows : [];
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0) || 9;

    const clone = () => JSON.parse(JSON.stringify(data.content || { rows: [] }));
    const setCell = (r: number, c: number, v: string) => {
        const next = clone();
        next.rows[r][c] = v;
        dispatch({ content: next });
    };
    const addRow = () => {
        const next = clone();
        const n = (next.rows[0] || []).length || cols;
        const seq = String(next.rows.length); // 数据行数（含表头行时约等于序号）
        const row = new Array(n).fill("");
        row[0] = seq;
        next.rows.push(row);
        dispatch({ content: next });
    };
    const delRow = (r: number) => {
        const next = clone();
        next.rows.splice(r, 1);
        dispatch({ content: next });
    };

    const doSave = () => {
        dispatch({ saving: true });
        Api.update_deq_doc({ id, content: data.content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_deq_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    开发设备清单
                    {readonly ? (
                        <span className="pdp-meta">
                            {data.doc.product_name ? `　${data.doc.product_name}` : ""}
                            {data.doc.product_full_version ? ` / ${data.doc.product_full_version}` : ""}
                            {data.doc.version ? `　文档版本：${data.doc.version}` : ""}
                        </span>
                    ) : (
                        <span className="pdp-meta" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                            <span style={{ width: 340, display: "inline-block" }}>
                                <ProductVersionSelect
                                    products={data.products}
                                    value={data.doc.product_id}
                                    allowClear={false}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(v) => v && rebindProduct(v)}
                                />
                            </span>
                            <span style={{ whiteSpace: "nowrap" }}>文档版本：</span>
                            <Input
                                size="small"
                                style={{ width: 110 }}
                                value={data.doc.version || ""}
                                onChange={(e) => dispatch({ doc: { ...data.doc, version: e.target.value } })}
                            />
                        </span>
                    )}
                </div>
                <Space>
                    {!readonly && <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/deq_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: 1200 }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>开发设备清单</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 12 }}>{data.doc.file_no || ""}</div>

                        {!readonly && (
                            <div style={{ marginBottom: 8 }}>
                                <Button size="small" onClick={addRow}>＋添加行</Button>
                            </div>
                        )}

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: 50 }} />
                                <col style={{ width: 90 }} />
                                <col style={{ width: 120 }} />
                                <col style={{ width: 90 }} />
                                <col style={{ width: 130 }} />
                                <col style={{ width: 90 }} />
                                <col style={{ width: 90 }} />
                                <col style={{ width: 70 }} />
                                <col style={{ width: 90 }} />
                                {!readonly && <col style={{ width: 50 }} />}
                            </colgroup>
                            <tbody>
                                {rows.map((row, r) => (
                                    <tr key={r}>
                                        {Array.from({ length: cols }).map((_, ci) => (
                                            <td key={ci} style={r === 0 ? thCell : tdValue}>
                                                {r === 0 || readonly
                                                    ? (row[ci] ?? "")
                                                    : <Input variant="borderless" style={{ textAlign: "center", padding: 0, fontSize: 13 }} value={String(row[ci] ?? "")} onChange={(e) => setCell(r, ci, e.target.value)} />}
                                            </td>
                                        ))}
                                        {!readonly && (
                                            <td style={{ ...tdValue }}>
                                                {r > 0 && <DeleteOutlined title="删除该行" style={{ color: "#c00", cursor: "pointer" }} onClick={() => delRow(r)} />}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
