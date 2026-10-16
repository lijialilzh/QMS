import { syncFileNoVersion } from "@/pages/doc_fill/syncDocVersion";
import { Button, Checkbox, Input, Modal, Space, Spin, Table, message } from "antd";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiUtpRecordDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

// 大表行索引（与 Word / default_content 一致）：
// 0:产品名称/完整版本 1:产品型号/测试工具 2:网络环境
// 3:测试设备需求表头 4:用户端 5:服务端
// 6:测试人员/测试日期 7:测试依据 8:测试目的
// 9:测试项目标题 10:列头  11+:测试项
const DATA_START = 11;

function parseCover(rows: any[][]): Record<string, string> {
    const c: Record<string, string> = {};
    if (rows[0]) { c["产品名称"] = rows[0][1] || ""; c["完整版本号"] = rows[0][6] || ""; }
    if (rows[1]) { c["产品型号"] = rows[1][1] || ""; c["测试工具"] = rows[1][6] || ""; }
    if (rows[2]) { c["网络环境"] = rows[2][1] || ""; }
    if (rows[4]) { c["用户端设备"] = rows[4][3] || ""; c["用户端数量"] = rows[4][6] || ""; c["用户端浏览器"] = rows[4][7] || ""; }
    if (rows[5]) { c["服务端设备"] = rows[5][3] || ""; c["服务端数量"] = rows[5][6] || ""; }
    if (rows[6]) { c["测试人员"] = rows[6][1] || ""; c["测试日期"] = rows[6][6] || ""; }
    if (rows[7]) { c["测试依据"] = rows[7][1] || ""; }
    if (rows[8]) { c["测试目的"] = rows[8][1] || ""; }
    return c;
}

function parseRecords(rows: any[][]): any[] {
    const out: any[] = [];
    for (let i = DATA_START; i < rows.length; i++) {
        const r = rows[i] || [];
        out.push({
            key: i - DATA_START,
            caseRange: r[0] || "",
            module: r[2] || "",
            result: r[4] || "",
            remark: r[6] || "",
        });
    }
    return out;
}

function parseResult(val: string): "pass" | "fail" | "" {
    const s = String(val || "");
    if (/■通过|☑通过|√通过|✓通过/.test(s)) return "pass";
    if (/■不通过|☑不通过|√不通过|✓不通过/.test(s)) return "fail";
    return "";
}

function formatResult(val: "pass" | "fail" | ""): string {
    if (val === "pass") return "■通过 □不通过";
    if (val === "fail") return "□通过 ■不通过";
    return "□通过 □不通过";
}

/** 展示：在「至」处换行；存盘仍用单行「A 至 B」。 */
function formatCaseDisplay(text: string): string {
    return String(text || "").replace(/\s*至\s*/, "\n至\n");
}

function parseCaseInput(text: string): string {
    return String(text || "")
        .replace(/\s*\n\s*至\s*\n\s*/g, " 至 ")
        .replace(/\s*\n\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** 表头样式对齐网络安全能力分析（#fafafa 标签 / #f0f5ff 分区） */
const tdStyle: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle" };
const labelStyle: CSSProperties = { ...tdStyle, background: "#fafafa", fontWeight: 600, color: "#555", width: 110, textAlign: "center", whiteSpace: "nowrap" };
const valueStyle: CSSProperties = { ...tdStyle, color: "#333", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 };

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const [data, dispatch] = useData({
        loading: false, saving: false, exporting: false,
        doc: {} as any, rows: [] as any[][], products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_utp_record_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) { dispatch({ loading: false }); message.error(res.msg); return; }
            const doc = res.data || {};
            const sections = doc.content?.sections || [];
            const bigTable = sections[0]?.tables?.[0] || [];
            dispatch({ loading: false, doc, rows: bigTable });
        });
    };

    useEffect(() => { load(); }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const rebindProduct = (newId: number) => {
        if (!id || newId === data.doc.product_id) return;
        Modal.confirm({
            title: "切换产品", content: "切换产品将重新获取产品信息与测试项，未保存的修改会丢失，是否继续？",
            okText: "切换", cancelText: "取消",
            onOk: () => {
                dispatch({ saving: true });
                Api.rebind_product({ id, product_id: newId }).then((res: any) => {
                    dispatch({ saving: false });
                    if (res.code === Api.C_OK) {
                        message.success(ts("save_success"));
                        const doc = res.data || {};
                        const sections = doc.content?.sections || [];
                        const bigTable = sections[0]?.tables?.[0] || [];
                        dispatch({ doc, rows: bigTable });
                    } else { message.error(res.msg); }
                });
            },
        });
    };

    const rows = data.rows || [];
    const cover = useMemo(() => parseCover(rows), [rows]);
    const records = useMemo(() => parseRecords(rows), [rows]);

    const setCover = (field: string, val: string) => {
        const next = rows.map((r: any[]) => [...r]);
        const fill = (ri: number, from: number, to: number, v: string) => {
            if (!next[ri]) return;
            for (let i = from; i <= to && i < next[ri].length; i++) next[ri][i] = v;
        };
        if (field === "产品名称") fill(0, 1, 4, val);
        if (field === "完整版本号") fill(0, 6, 7, val);
        if (field === "产品型号") fill(1, 1, 4, val);
        if (field === "测试工具") fill(1, 6, 7, val);
        if (field === "网络环境") fill(2, 1, 7, val);
        if (field === "用户端设备") fill(4, 3, 5, val);
        if (field === "用户端数量" && next[4]) next[4][6] = val;
        if (field === "用户端浏览器" && next[4]) next[4][7] = val;
        if (field === "服务端设备") fill(5, 3, 5, val);
        if (field === "服务端数量" && next[5]) next[5][6] = val;
        if (field === "测试人员") fill(6, 1, 4, val);
        if (field === "测试日期") fill(6, 6, 7, val);
        if (field === "测试依据") fill(7, 1, 7, val);
        if (field === "测试目的") fill(8, 1, 7, val);
        dispatch({ rows: next });
    };

    const setRecord = (idx: number, field: string, val: string) => {
        const next = rows.map((r: any[]) => [...r]);
        const ri = DATA_START + idx;
        if (next[ri]) {
            if (field === "result") { next[ri][4] = val; next[ri][5] = val; }
            if (field === "remark") { next[ri][6] = val; next[ri][7] = val; }
            if (field === "caseRange") { next[ri][0] = val; next[ri][1] = val; }
            if (field === "module") { next[ri][2] = val; next[ri][3] = val; }
        }
        dispatch({ rows: next });
    };

    const doSave = () => {
        dispatch({ saving: true });
        const sections = [{ title: "用户测试记录", ref_type: "cover", body: "", tables: [rows], children: [] }];
        Api.update_utp_record_doc({ id, content: { sections }, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_utp_record_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) { message.error("导出失败"); }
        finally { dispatch({ exporting: false }); }
    };

    const editCell = (value: string, onChange: (v: string) => void, multiline = false) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 20, lineHeight: 1.45 }}>{value || ""}</div>
            : multiline
                ? <Input.TextArea
                    variant="borderless"
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    style={{ padding: 0, fontSize: 12, lineHeight: 1.45, resize: "none" }}
                    value={value ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                />
                : <Input variant="borderless" size="small" style={{ padding: 0, fontSize: 12 }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const moduleSpans = useMemo(() => {
        const spans: Record<number, number> = {};
        let prev = ""; let start = -1;
        records.forEach((r, i) => {
            if (r.module !== prev) {
                if (start >= 0) spans[start] = i - start;
                start = i; prev = r.module;
            }
        });
        if (start >= 0) spans[start] = records.length - start;
        return spans;
    }, [records]);

    const columns = [
        {
            title: "Case编号", dataIndex: "caseRange", width: "28%",
            onCell: () => ({ style: { background: "#fff", verticalAlign: "middle" } }),
            render: (text: string, _r: any, idx: number) => (
                readonly
                    ? <div style={{ whiteSpace: "pre-line", lineHeight: 1.5, fontSize: 12, wordBreak: "break-all" }}>{formatCaseDisplay(text)}</div>
                    : <Input.TextArea
                        variant="borderless"
                        autoSize={{ minRows: 3, maxRows: 4 }}
                        style={{ padding: 0, fontSize: 12, lineHeight: 1.5, resize: "none", wordBreak: "break-all" }}
                        value={formatCaseDisplay(text)}
                        onChange={(e) => setRecord(idx, "caseRange", parseCaseInput(e.target.value))}
                    />
            ),
        },
        {
            title: "功能模块", dataIndex: "module", width: "18%",
            onCell: (_r: any, index?: number) => ({
                rowSpan: moduleSpans[index ?? 0] || 0,
                style: { fontWeight: 600, background: "#fafafa", verticalAlign: "middle" },
            }),
            render: (text: string) => text,
        },
        {
            title: "是否通过", dataIndex: "result", width: "26%",
            onCell: () => ({ style: { background: "#fff", verticalAlign: "middle" } }),
            render: (text: string, _r: any, idx: number) => {
                const val = parseResult(text);
                if (readonly) {
                    return <span style={{ color: val === "pass" ? "#52c41a" : val === "fail" ? "#ff4d4f" : "#999", fontWeight: val ? 600 : 400 }}>
                        {val === "pass" ? "■通过" : val === "fail" ? "■不通过" : "□通过 □不通过"}
                    </span>;
                }
                return (
                    <Space size={8}>
                        <Checkbox
                            style={{ fontSize: 12 }}
                            checked={val === "pass"}
                            onChange={(e) => setRecord(idx, "result", formatResult(e.target.checked ? "pass" : ""))}
                        >通过</Checkbox>
                        <Checkbox
                            style={{ fontSize: 12 }}
                            checked={val === "fail"}
                            onChange={(e) => setRecord(idx, "result", formatResult(e.target.checked ? "fail" : ""))}
                        >不通过</Checkbox>
                    </Space>
                );
            },
        },
        {
            title: "备注", dataIndex: "remark", width: "28%",
            onCell: () => ({ style: { background: "#fff", verticalAlign: "middle" } }),
            render: (text: string, _r: any, idx: number) => editCell(text, (v) => setRecord(idx, "remark", v)),
        },
    ];

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                {!readonly && <div className="pdp-toolbar-title">
                    选择产品
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
                            <Input size="small" style={{ width: 110 }} value={data.doc.version || ""}
                                onChange={(e) => { const version = e.target.value; dispatch({ doc: { ...data.doc, version } }); }} />
                        </span>
                </div>}
                <Space>
                    {!readonly && <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/utp_record_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px" }}>
                        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "4px 0 4px" }}>用户测试记录</div>
                        <div style={{ textAlign: "center", color: "#888", marginBottom: 12 }}>{syncFileNoVersion(data.doc.file_no, data.doc.version) || ""}</div>

                        {/* 封面与测试项目同一宽度，左右边框对齐 */}
                        <div style={{ maxWidth: 980, width: "100%", marginBottom: 16 }}>
                            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
                                <colgroup>
                                    <col style={{ width: 110 }} />
                                    <col />
                                    <col style={{ width: 110 }} />
                                    <col style={{ width: 220 }} />
                                </colgroup>
                                <tbody>
                                    <tr>
                                        <td style={labelStyle}>产品名称</td>
                                        <td style={valueStyle}>{editCell(cover["产品名称"] || "", (v) => setCover("产品名称", v))}</td>
                                        <td style={labelStyle}>完整版本号</td>
                                        <td style={valueStyle}>{editCell(cover["完整版本号"] || "", (v) => setCover("完整版本号", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>产品型号</td>
                                        <td style={valueStyle}>{editCell(cover["产品型号"] || "", (v) => setCover("产品型号", v))}</td>
                                        <td style={labelStyle}>测试工具</td>
                                        <td style={valueStyle}>{editCell(cover["测试工具"] || "", (v) => setCover("测试工具", v), true)}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>网络环境</td>
                                        <td style={valueStyle} colSpan={3}>{editCell(cover["网络环境"] || "", (v) => setCover("网络环境", v), true)}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>用户端设备</td>
                                        <td style={valueStyle}>{editCell(cover["用户端设备"] || "", (v) => setCover("用户端设备", v), true)}</td>
                                        <td style={labelStyle}>数量/浏览器</td>
                                        <td style={valueStyle}>
                                            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                                                {editCell(cover["用户端数量"] || "", (v) => setCover("用户端数量", v))}
                                                <span>/</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>{editCell(cover["用户端浏览器"] || "", (v) => setCover("用户端浏览器", v), true)}</div>
                                            </div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>服务端设备</td>
                                        <td style={valueStyle}>{editCell(cover["服务端设备"] || "", (v) => setCover("服务端设备", v), true)}</td>
                                        <td style={labelStyle}>数量</td>
                                        <td style={valueStyle}>{editCell(cover["服务端数量"] || "", (v) => setCover("服务端数量", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>测试人员</td>
                                        <td style={valueStyle}>{editCell(cover["测试人员"] || "", (v) => setCover("测试人员", v))}</td>
                                        <td style={labelStyle}>测试日期</td>
                                        <td style={valueStyle}>{editCell(cover["测试日期"] || "", (v) => setCover("测试日期", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>测试依据</td>
                                        <td style={valueStyle} colSpan={3}>{editCell(cover["测试依据"] || "", (v) => setCover("测试依据", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>测试目的</td>
                                        <td style={valueStyle} colSpan={3}>{editCell(cover["测试目的"] || "", (v) => setCover("测试目的", v))}</td>
                                    </tr>
                                </tbody>
                            </table>

                            <div style={{ marginTop: 16, fontSize: 14, fontWeight: 600, color: "#1d39c4", background: "#f0f5ff", padding: "6px 10px", border: "1px solid #d9d9d9", borderBottom: "none", boxSizing: "border-box" }}>测试项目</div>
                            <Table
                                className="ftr-record-table utp-record-table"
                                columns={columns}
                                dataSource={records}
                                pagination={false}
                                size="small"
                                bordered
                                rowKey="key"
                                tableLayout="fixed"
                                style={{ width: "100%" }}
                            />
                            <div style={{ marginTop: 24, fontSize: 14, lineHeight: 2.2, color: "#333" }}>
                                <div>签名：</div>
                                <div>日期：</div>
                            </div>
                        </div>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
