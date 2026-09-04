import { Button, Input, Space, Spin, message } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiModelDoc";
import * as ApiProduct from "@/api/ApiProduct";
import { getModelDocMeta } from "./ModelDocTypes";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap", textAlign: "center" };
const barCell: CSSProperties = { ...tdBase, background: "#fafafa", fontWeight: 600, textAlign: "center" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center" };
const tdOp: CSSProperties = { ...tdBase, width: 100, textAlign: "center", whiteSpace: "nowrap" };

const DEFAULT_CONTENT = {
    author: "",
    write_date: "",
    data_use: "",
    data_type: "",
    method: "",
    case_count: "",
    annotator: "",
    dist_rows: [["因素", "类别", "数量", "占比"]],
    author_sign: "",
    auditor_sign: "",
};

const pad4 = (row: any[]) => {
    const cells = (row || []).map((c) => String(c ?? ""));
    while (cells.length < 4) cells.push("");
    return cells.slice(0, 4);
};

const parseQty = (v: any) => {
    const s = String(v ?? "").replace(/,/g, "").trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};

const parsePct = (v: any) => {
    const s = String(v ?? "").trim();
    if (!s) return 0;
    if (s.endsWith("%")) {
        const n = Number(s.slice(0, -1).trim());
        return Number.isFinite(n) ? n : 0;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return Math.abs(n) <= 1.0001 ? n * 100 : n;
};

const computeBuildTotal = (rows: any[][]) => {
    const list = (rows || []).map(pad4);
    const totalAt = list.findIndex((r) => String(r[0] ?? "").trim() === "总计");
    const end = totalAt >= 0 ? totalAt : list.length;
    let start = 1;
    for (let i = end - 1; i >= 1; i--) {
        const a = String(list[i][0] ?? "").trim();
        if (a && a !== "总计") { start = i; break; }
    }
    let qty = 0;
    let pct = 0;
    for (let i = start; i < end; i++) {
        qty += parseQty(list[i][2]);
        pct += parsePct(list[i][3]);
    }
    const qtyStr = Math.abs(qty - Math.round(qty)) < 1e-9 ? String(Math.round(qty)) : String(qty);
    let pctStr = `${pct.toFixed(2)}%`;
    if (pct === 0 && qty > 0) pctStr = "100.00%";
    else if (Math.abs(pct - 100) < 0.05) pctStr = "100.00%";
    return { qty: qtyStr, pct: pctStr };
};

const applyBuildTotal = (rows: any[][]) => {
    const list = (rows || []).map(pad4);
    const { qty, pct } = computeBuildTotal(list);
    const totalAt = list.findIndex((r) => String(r[0] ?? "").trim() === "总计");
    const totalRow = ["总计", "", qty, pct];
    if (totalAt >= 0) list[totalAt] = totalRow;
    else list.push(totalRow);
    return list;
};

const factorMeta = (rows: any[][]) => {
    const skip = new Set<number>();
    const spans = rows.map(() => 1);
    for (let i = 1; i < rows.length; i++) {
        if (skip.has(i)) continue;
        const a = String(rows[i][0] ?? "").trim();
        if (!a || a === "总计") continue;
        let j = i + 1;
        while (j < rows.length && !String(rows[j][0] ?? "").trim()) j++;
        spans[i] = j - i;
        for (let k = i + 1; k < j; k++) skip.add(k);
    }
    return { skip, spans };
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id, type } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const meta = getModelDocMeta(type);
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        content: { ...DEFAULT_CONTENT } as any,
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_model_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const content = { ...DEFAULT_CONTENT, ...(doc.content || {}) };
            if (!Array.isArray(content.dist_rows) || !content.dist_rows.length) {
                content.dist_rows = DEFAULT_CONTENT.dist_rows;
            }
            dispatch({ loading: false, doc, content });
        });
    };

    useEffect(() => { load(); }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({
            doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version },
        });
    };

    const setField = (key: string, value: any) => {
        dispatch({ content: { ...data.content, [key]: value } });
    };

    const setDist = (r: number, c: number, value: string) => {
        const dist_rows = (data.content.dist_rows || []).map((row: any[], ri: number) =>
            ri === r ? pad4(row).map((cell, ci) => (ci === c ? value : cell)) : row
        );
        dispatch({ content: { ...data.content, dist_rows } });
    };

    const addDistRowAfter = (r: number) => {
        const dist_rows = [...(data.content.dist_rows || [])];
        const isTotal = String(dist_rows[r]?.[0] ?? "").trim() === "总计";
        dist_rows.splice(isTotal ? r : r + 1, 0, ["", "", "", ""]);
        dispatch({ content: { ...data.content, dist_rows } });
    };

    const delDistRow = (r: number) => {
        const dist_rows = (data.content.dist_rows || []).filter((_: any, i: number) => i !== r);
        dispatch({ content: { ...data.content, dist_rows } });
    };

    const doSave = () => {
        dispatch({ saving: true });
        const content = { ...data.content, dist_rows: applyBuildTotal(data.content.dist_rows || []) };
        Api.update_model_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false, content });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_model_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const c = data.content || {};
    const dist: any[][] = Array.isArray(c.dist_rows) ? c.dist_rows.map(pad4) : [];
    const { skip, spans } = factorMeta(dist);
    const totals = computeBuildTotal(dist);

    const editValue = (value: string, onChange: (v: string) => void, style: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...style }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 8 }} style={{ padding: 0, textAlign: "center", ...style }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const signCell = (value: string, onChange: (v: string) => void) => (
        String(value || "").startsWith("data:image")
            ? <img src={value} alt="" style={{ maxHeight: 36 }} />
            : editValue(value, onChange)
    );

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    {meta.title}
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
                    <Button onClick={() => navigate(`/model_docs/${type}`)}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: 960 }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>{meta.title}</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "32%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "32%" }} />
                                {!readonly && <col style={{ width: 100 }} />}
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>编写人</td>
                                    <td style={tdValue}>{editValue(c.author, (v) => setField("author", v))}</td>
                                    <td style={tdLabel}>编写时间</td>
                                    <td style={tdValue}>{editValue(c.write_date, (v) => setField("write_date", v))}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>数据用途</td>
                                    <td style={tdValue}>{editValue(c.data_use, (v) => setField("data_use", v))}</td>
                                    <td style={tdLabel}>数据类型</td>
                                    <td style={tdValue}>{editValue(c.data_type, (v) => setField("data_type", v))}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>构建方法</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={3}>{editValue(c.method, (v) => setField("method", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>病例数量</td>
                                    <td style={tdValue}>{c.case_count || ""}</td>
                                    <td style={tdLabel}>标记人员及方式</td>
                                    <td style={tdValue}>{editValue(c.annotator, (v) => setField("annotator", v))}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={barCell} colSpan={4}>数据分布</td>
                                    {!readonly && <td style={thCell} />}
                                </tr>
                                {dist.map((row, r) => {
                                    if (r === 0) {
                                        return (
                                            <tr key={r}>
                                                {row.map((cell: string, ci: number) => (
                                                    <td key={ci} style={thCell}>{cell}</td>
                                                ))}
                                                {!readonly && <td style={{ ...thCell, width: 100 }}>操作</td>}
                                            </tr>
                                        );
                                    }
                                    const isTotal = String(row[0] ?? "").trim() === "总计";
                                    return (
                                        <tr key={r}>
                                            {skip.has(r) ? null : (
                                                <td style={{ ...tdValue, fontWeight: 600 }} rowSpan={spans[r]}>
                                                    {isTotal ? "总计" : editValue(row[0], (v) => setDist(r, 0, v))}
                                                </td>
                                            )}
                                            <td style={tdValue}>{isTotal ? "" : editValue(row[1], (v) => setDist(r, 1, v))}</td>
                                            <td style={tdValue}>{isTotal ? totals.qty : editValue(row[2], (v) => setDist(r, 2, v))}</td>
                                            <td style={tdValue}>{isTotal ? totals.pct : editValue(row[3], (v) => setDist(r, 3, v))}</td>
                                            {!readonly && (
                                                <td style={tdOp}>
                                                    <span style={{ display: "inline-flex", gap: 14, justifyContent: "center" }}>
                                                        <PlusOutlined style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => addDistRowAfter(r)} />
                                                        {isTotal ? null : (
                                                            <DeleteOutlined style={{ color: "#999", cursor: "pointer" }} onClick={() => delDistRow(r)} />
                                                        )}
                                                    </span>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                <tr>
                                    <td style={tdLabel}>编写人签字（日期）</td>
                                    <td style={{ ...tdValue, height: 44 }}>{signCell(c.author_sign, (v) => setField("author_sign", v))}</td>
                                    <td style={tdLabel}>审核人签字（日期）</td>
                                    <td style={{ ...tdValue, height: 44 }}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
