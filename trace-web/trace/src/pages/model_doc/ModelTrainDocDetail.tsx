import { Button, Input, Space, Spin, message } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as echarts from "echarts";
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

const DEFAULT_CONTENT = {
    author: "",
    write_date: "",
    auditor: "",
    model_name: "",
    model_func: "",
    train_set: "",
    case_count: "",
    train_time: "",
    hw_env: "",
    sw_env: "",
    eval_points: [["数据量", "DICE"]],
    process_points: [["step", "loss"]],
    eval_img: "",
    process_img: "",
    conclusion: "",
    author_sign: "",
    auditor_sign: "",
};

const pad = (row: any[], n: number) => {
    const cells = (row || []).map((c) => String(c ?? ""));
    while (cells.length < n) cells.push("");
    return cells.slice(0, n);
};

const lastEvalX = (rows: any[][]) => {
    let last = "";
    (rows || []).forEach((r, i) => {
        if (i === 0) return;
        const a = String(r?.[0] ?? "").trim();
        if (a) last = a;
    });
    return last;
};

const toNum = (v: any) => {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
};

const chartPng = (option: any, w: number, h: number) => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:-99999px;top:0;width:${w}px;height:${h}px;`;
    document.body.appendChild(el);
    const chart = echarts.init(el);
    chart.setOption({ animation: false, ...option });
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    chart.dispose();
    document.body.removeChild(el);
    return url;
};

const buildEvalChart = (isPe: boolean, rows: any[][]) => {
    const data = (rows || []).slice(1).map((r) => pad(r, isPe ? 3 : 2)).filter((r) => r[0].trim());
    const xs = data.map((r) => r[0]);
    const labelFrom = Math.max(0, data.length - 3);
    const fmt = (idx: number, val: any) => (idx >= labelFrom ? String(val) : "");
    const series = isPe
        ? [
            { name: "灵敏度", type: "line", data: data.map((r) => toNum(r[1])), itemStyle: { color: "#4472C4" }, lineStyle: { color: "#4472C4", width: 2 }, label: { show: true, formatter: (p: any) => fmt(p.dataIndex, p.value), fontSize: 10 } },
            { name: "特异度", type: "line", data: data.map((r) => toNum(r[2])), itemStyle: { color: "#ED7D31" }, lineStyle: { color: "#ED7D31", width: 2 }, label: { show: true, formatter: (p: any) => fmt(p.dataIndex, p.value), fontSize: 10 } },
        ]
        : [
            { name: "DICE", type: "line", data: data.map((r) => toNum(r[1])), itemStyle: { color: "#4472C4" }, lineStyle: { color: "#4472C4", width: 3 }, label: { show: true, formatter: (p: any) => fmt(p.dataIndex, p.value), fontSize: 10 } },
        ];
    return chartPng({
        title: { text: "训练数据量评估曲线", left: "center", textStyle: { fontSize: 14 } },
        legend: isPe ? { data: ["灵敏度", "特异度"], bottom: 0 } : { show: false },
        grid: { left: 56, right: 24, top: 40, bottom: isPe ? 48 : 36 },
        xAxis: { type: "category", name: "训练数据量", data: xs, nameLocation: "middle", nameGap: 24 },
        yAxis: { type: "value", name: isPe ? "指标值" : "DICE系数", min: 0, max: 1, interval: 0.1 },
        series,
    }, 900, 320);
};

const buildProcessChart = (isPe: boolean, rows: any[][]) => {
    const data = (rows || []).slice(1).map((r) => pad(r, 2)).map((r) => [toNum(r[0]), toNum(r[1])]).filter((p) => p[0] != null && p[1] != null);
    const color = isPe ? "#4472C4" : "#ED7D31";
    return chartPng({
        title: { text: "训练过程曲线", left: "center", textStyle: { fontSize: 14 } },
        grid: { left: 56, right: 24, top: 40, bottom: 36 },
        xAxis: { type: "value", name: "step", nameLocation: "middle", nameGap: 24 },
        yAxis: { type: "value", name: "loss" },
        series: [{ type: "line", showSymbol: false, data, itemStyle: { color }, lineStyle: { color, width: 2 } }],
    }, 900, 260);
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id, type } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const meta = getModelDocMeta(type);
    const isPe = type === "md_012_01";
    const evalCols = isPe ? 3 : 2;
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
            if (!Array.isArray(content.eval_points) || !content.eval_points.length) {
                content.eval_points = DEFAULT_CONTENT.eval_points;
            }
            if (!Array.isArray(content.process_points) || !content.process_points.length) {
                content.process_points = DEFAULT_CONTENT.process_points;
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

    const setGrid = (key: string, r: number, c: number, value: string, n: number) => {
        const rows = (data.content[key] || []).map((row: any[], ri: number) =>
            ri === r ? pad(row, n).map((cell, ci) => (ci === c ? value : cell)) : row
        );
        dispatch({ content: { ...data.content, [key]: rows } });
    };

    const addRow = (key: string, r: number, n: number) => {
        const rows = [...(data.content[key] || [])];
        rows.splice(r + 1, 0, Array.from({ length: n }, () => ""));
        dispatch({ content: { ...data.content, [key]: rows } });
    };

    const delRow = (key: string, r: number) => {
        const rows = (data.content[key] || []).filter((_: any, i: number) => i !== r);
        dispatch({ content: { ...data.content, [key]: rows } });
    };

    const c = data.content || {};
    const evalImg = useMemo(() => buildEvalChart(isPe, c.eval_points || []), [isPe, c.eval_points]);
    const processImg = useMemo(() => buildProcessChart(isPe, c.process_points || []), [isPe, c.process_points]);
    const autoCount = String(c.case_count || "").trim() || lastEvalX(c.eval_points || []);

    const packed = () => ({
        ...data.content,
        case_count: autoCount,
        eval_img: evalImg,
        process_img: processImg,
    });

    const doSave = () => {
        dispatch({ saving: true });
        const content = packed();
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
            if (!readonly) {
                const content = packed();
                const saveRes: any = await Api.update_model_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version });
                if (saveRes.code !== Api.C_OK) {
                    message.error(saveRes.msg || "保存失败");
                    return;
                }
                dispatch({ content });
            }
            const res: any = await Api.export_model_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

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

    const pointTable = (key: string, rows: any[][], cols: number, headers: string[]) => (
        <table style={tableStyle}>
            <tbody>
                <tr>
                    {headers.map((h) => <td key={h} style={thCell}>{h}</td>)}
                    {!readonly ? (
                        <td style={thCell}>
                            <PlusOutlined style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => addRow(key, 0, cols)} />
                        </td>
                    ) : null}
                </tr>
                {(rows || []).slice(1).map((row, i) => {
                    const r = i + 1;
                    const cells = pad(row, cols);
                    return (
                        <tr key={r}>
                            {cells.map((cell, ci) => (
                                <td key={ci} style={tdValue}>{editValue(cell, (v) => setGrid(key, r, ci, v, cols))}</td>
                            ))}
                            {!readonly ? (
                                <td style={{ ...tdValue, width: 56 }}>
                                    <span style={{ display: "inline-flex", gap: 6 }}>
                                        <PlusOutlined style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => addRow(key, r, cols)} />
                                        <DeleteOutlined style={{ color: "#999", cursor: "pointer" }} onClick={() => delRow(key, r)} />
                                    </span>
                                </td>
                            ) : null}
                        </tr>
                    );
                })}
            </tbody>
        </table>
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
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "16%" }} />
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>编写人</td>
                                    <td style={tdValue}>{editValue(c.author, (v) => setField("author", v))}</td>
                                    <td style={tdLabel}>编写日期</td>
                                    <td style={tdValue}>{editValue(c.write_date, (v) => setField("write_date", v))}</td>
                                    <td style={tdLabel}>审核人</td>
                                    <td style={tdValue}>{editValue(c.auditor, (v) => setField("auditor", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>模型名称</td>
                                    <td style={tdValue} colSpan={5}>{editValue(c.model_name, (v) => setField("model_name", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>模型功能</td>
                                    <td style={tdValue} colSpan={5}>{editValue(c.model_func, (v) => setField("model_func", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>训练集</td>
                                    <td style={tdValue} colSpan={2}>{editValue(c.train_set, (v) => setField("train_set", v))}</td>
                                    <td style={tdLabel}>数量</td>
                                    <td style={tdValue} colSpan={2}>{autoCount}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>训练时间</td>
                                    <td style={tdValue} colSpan={5}>{editValue(c.train_time, (v) => setField("train_time", v))}</td>
                                </tr>
                                <tr>
                                    <td style={barCell} colSpan={6}>训练环境</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>硬件环境</td>
                                    <td style={tdValue} colSpan={5}>{editValue(c.hw_env, (v) => setField("hw_env", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>软件环境</td>
                                    <td style={tdValue} colSpan={5}>{editValue(c.sw_env, (v) => setField("sw_env", v))}</td>
                                </tr>
                                <tr>
                                    <td style={barCell} colSpan={6}>训练数据量评估曲线</td>
                                </tr>
                                <tr>
                                    <td style={tdValue} colSpan={6}>
                                        {evalImg ? <img src={evalImg} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "contain" }} /> : null}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        {pointTable("eval_points", c.eval_points || [], evalCols, isPe ? ["数据量", "灵敏度", "特异度"] : ["数据量", "DICE"])}

                        <table style={tableStyle}>
                            <tbody>
                                <tr>
                                    <td style={barCell}>训练过程曲线</td>
                                </tr>
                                <tr>
                                    <td style={tdValue}>
                                        {processImg ? <img src={processImg} alt="" style={{ width: "100%", maxHeight: 240, objectFit: "contain" }} /> : null}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        {pointTable("process_points", c.process_points || [], 2, ["step", "loss"])}

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "16%" }} />
                                <col />
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>结论</td>
                                    <td style={{ ...tdValue, textAlign: "left" }}>{editValue(c.conclusion, (v) => setField("conclusion", v), { textAlign: "left" })}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>编写人（签字）/日期</td>
                                    <td style={{ ...tdValue, height: 44 }}>{signCell(c.author_sign, (v) => setField("author_sign", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>审核人（签字）/日期</td>
                                    <td style={{ ...tdValue, height: 44 }}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
