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
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 8px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap", textAlign: "center" };
const barCell: CSSProperties = { ...tdBase, background: "#fafafa", fontWeight: 600, textAlign: "center" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center" };
const tdOp: CSSProperties = { ...tdBase, width: 100, textAlign: "center", whiteSpace: "nowrap" };

const DEFAULT_CONTENT = {
    author: "",
    write_date: "",
    auditor: "",
    model_name: "",
    test_set: "",
    method: "",
    test_time: "",
    hw_env: "",
    sw_env: "",
    result_rows: [] as string[][],
    conclusion: "",
    author_sign: "",
    auditor_sign: "",
};

const peHeader = ["因素", "类别", "阳性数据量", "阴性数据量", "灵敏度(95%CI区间)", "特异度(95%CI区间)"];
const lobeHeader = ["因素", "类别", "样本量", "dice均值", "dice方差"];

const padN = (row: any[], n: number) => {
    const cells = (row || []).map((c) => String(c ?? ""));
    while (cells.length < n) cells.push("");
    return cells.slice(0, n);
};

const parseQty = (v: any) => {
    const s = String(v ?? "").replace(/,/g, "").trim();
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};

const qtyCols = (isPe: boolean) => (isPe ? [2, 3] : [2]);

const computeTestQty = (rows: any[][], isPe: boolean) => {
    const n = isPe ? 6 : 5;
    const list = (rows || []).map((r) => padN(r, n));
    const totalAt = list.findIndex((r) => String(r[0] ?? "").trim() === "总计");
    const end = totalAt >= 0 ? totalAt : list.length;
    let start = 1;
    for (let i = end - 1; i >= 1; i--) {
        const a = String(list[i][0] ?? "").trim();
        if (a && a !== "总计") { start = i; break; }
    }
    const out: Record<number, string> = {};
    for (const ci of qtyCols(isPe)) {
        let qty = 0;
        for (let i = start; i < end; i++) qty += parseQty(list[i][ci]);
        out[ci] = Math.abs(qty - Math.round(qty)) < 1e-9 ? String(Math.round(qty)) : String(qty);
    }
    return out;
};

const applyTestTotal = (rows: any[][], isPe: boolean) => {
    const n = isPe ? 6 : 5;
    const list = (rows || []).map((r) => padN(r, n));
    const qtys = computeTestQty(list, isPe);
    const totalAt = list.findIndex((r) => String(r[0] ?? "").trim() === "总计");
    const old = totalAt >= 0 ? list[totalAt] : Array(n).fill("");
    const total = ["总计", ...Array(n - 1).fill("")];
    for (let ci = 1; ci < n; ci++) {
        total[ci] = qtyCols(isPe).includes(ci) ? (qtys[ci] || "0") : (old[ci] || "");
    }
    if (totalAt >= 0) list[totalAt] = total;
    else list.push(total);
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
    const isPe = type === "md_013_01";
    const cols = isPe ? 6 : 5;
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
            if (!Array.isArray(content.result_rows) || !content.result_rows.length) {
                content.result_rows = isPe ? [peHeader] : [lobeHeader];
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

    const setResult = (r: number, c: number, value: string) => {
        const result_rows = (data.content.result_rows || []).map((row: any[], ri: number) =>
            ri === r ? padN(row, cols).map((cell, ci) => (ci === c ? value : cell)) : row
        );
        dispatch({ content: { ...data.content, result_rows } });
    };

    const addResultRowAfter = (r: number) => {
        const result_rows = [...(data.content.result_rows || [])];
        const isTotal = String(result_rows[r]?.[0] ?? "").trim() === "总计";
        result_rows.splice(isTotal ? r : r + 1, 0, Array(cols).fill(""));
        dispatch({ content: { ...data.content, result_rows } });
    };

    const delResultRow = (r: number) => {
        const result_rows = (data.content.result_rows || []).filter((_: any, i: number) => i !== r);
        dispatch({ content: { ...data.content, result_rows } });
    };

    const doSave = () => {
        dispatch({ saving: true });
        const content = { ...data.content, result_rows: applyTestTotal(data.content.result_rows || [], isPe) };
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
    const result: any[][] = Array.isArray(c.result_rows) ? c.result_rows.map((r: any[]) => padN(r, cols)) : [];
    const { skip, spans } = factorMeta(result);
    const totals = computeTestQty(result, isPe);

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

    const renderResultCell = (row: string[], r: number, ci: number, isTotal: boolean) => {
        const qty = qtyCols(isPe).includes(ci);
        if (isTotal && qty) return totals[ci] || "0";
        return editValue(row[ci], (v) => setResult(r, ci, v));
    };

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
                    <div style={{ padding: "12px 20px", maxWidth: 1180 }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>{meta.title}</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "14%" }} />
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "14%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "19%" }} />
                                <col style={{ width: "19%" }} />
                                {!readonly && <col style={{ width: 100 }} />}
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>编写人</td>
                                    <td style={tdValue}>{editValue(c.author, (v) => setField("author", v))}</td>
                                    <td style={tdLabel}>编写日期</td>
                                    <td style={tdValue}>{editValue(c.write_date, (v) => setField("write_date", v))}</td>
                                    <td style={tdLabel}>审核人</td>
                                    <td style={tdValue}>{editValue(c.auditor, (v) => setField("auditor", v))}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>测试模型名称</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.model_name, (v) => setField("model_name", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>测试集</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.test_set, (v) => setField("test_set", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>测试方法</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.method, (v) => setField("method", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>测试时间</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.test_time, (v) => setField("test_time", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={barCell} colSpan={6}>测试环境</td>
                                    {!readonly && <td style={thCell} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>硬件环境</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.hw_env, (v) => setField("hw_env", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>软件环境</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.sw_env, (v) => setField("sw_env", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={barCell} colSpan={6}>测试结果</td>
                                    {!readonly && <td style={thCell} />}
                                </tr>
                                {result.map((row, r) => {
                                    const lastCol = cols - 1;
                                    const cellSpan = (ci: number) => (!isPe && ci === lastCol ? 2 : 1);
                                    if (r === 0) {
                                        return (
                                            <tr key={r}>
                                                {row.map((cell: string, ci: number) => (
                                                    <td key={ci} style={thCell} colSpan={cellSpan(ci)}>{cell}</td>
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
                                                    {isTotal ? "总计" : editValue(row[0], (v) => setResult(r, 0, v))}
                                                </td>
                                            )}
                                            {row.slice(1).map((_: string, idx: number) => {
                                                const ci = idx + 1;
                                                return (
                                                    <td key={ci} style={tdValue} colSpan={cellSpan(ci)}>
                                                        {renderResultCell(row, r, ci, isTotal)}
                                                    </td>
                                                );
                                            })}
                                            {!readonly && (
                                                <td style={tdOp}>
                                                    <span style={{ display: "inline-flex", gap: 14, justifyContent: "center" }}>
                                                        <PlusOutlined style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => addResultRowAfter(r)} />
                                                        {isTotal ? null : (
                                                            <DeleteOutlined style={{ color: "#999", cursor: "pointer" }} onClick={() => delResultRow(r)} />
                                                        )}
                                                    </span>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                                <tr>
                                    <td style={tdLabel}>结论</td>
                                    <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.conclusion, (v) => setField("conclusion", v), { textAlign: "left" })}</td>
                                    {!readonly && <td style={tdOp} />}
                                </tr>
                                <tr>
                                    <td style={tdLabel}>编写人（签字）/日期</td>
                                    <td style={{ ...tdValue, height: 44 }} colSpan={2}>{signCell(c.author_sign, (v) => setField("author_sign", v))}</td>
                                    <td style={tdLabel}>审核人（签字）/日期</td>
                                    <td style={{ ...tdValue, height: 44 }} colSpan={2}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
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
