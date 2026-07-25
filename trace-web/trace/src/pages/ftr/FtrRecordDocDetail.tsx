import { Button, Input, Modal, Radio, Space, Spin, Table, message } from "antd";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiFtrRecordDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

// 大表行索引含义（与 docx 一致）：
// 0: 产品名称/完整版本号  1: 序列号  2: 测试日期/测试人员
// 3: 测试依据  4: 测试目的  5: "测试项目"分组标题  6: 列头
// 7+: 测试记录条目（功能模块/功能/测试结果/备注）
const DATA_START = 7;

function parseCover(rows: any[][]): Record<string, string> {
    const c: Record<string, string> = {};
    if (rows[0]) { c["产品名称"] = rows[0][1] || ""; c["完整版本号"] = rows[0][3] || ""; }
    if (rows[1]) { c["序列号"] = rows[1][1] || ""; }
    if (rows[2]) { c["测试日期"] = rows[2][1] || ""; c["测试人员"] = rows[2][3] || ""; }
    if (rows[3]) { c["测试依据"] = rows[3][1] || ""; }
    if (rows[4]) { c["测试目的"] = rows[4][1] || ""; }
    return c;
}

function parseRecords(rows: any[][]): any[] {
    const out: any[] = [];
    for (let i = DATA_START; i < rows.length; i++) {
        const r = rows[i] || [];
        out.push({ key: i - DATA_START, module: r[0] || "", func: r[1] || "", result: r[2] || "", remark: r[4] || "" });
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
    if (val === "pass") return "■通过   □不通过";
    if (val === "fail") return "□通过   ■不通过";
    return "□通过   □不通过";
}

const tdStyle: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 8px", fontSize: 12, verticalAlign: "middle" };
const labelStyle: CSSProperties = { ...tdStyle, background: "#fafafa", fontWeight: 600, color: "#555", width: 120, textAlign: "center" };
const valueStyle: CSSProperties = { ...tdStyle, color: "#333", whiteSpace: "pre-wrap" };

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
        Api.get_ftr_record_doc({ id }).then((res: any) => {
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
            title: "切换产品", content: "切换产品将重新获取产品信息，未保存的修改会丢失，是否继续？",
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
        if (field === "产品名称" && next[0]) next[0][1] = val;
        if (field === "完整版本号" && next[0]) next[0][3] = val;
        if (field === "序列号" && next[1]) next[1][1] = val;
        if (field === "测试日期" && next[2]) next[2][1] = val;
        if (field === "测试人员" && next[2]) next[2][3] = val;
        if (field === "测试依据" && next[3]) next[3][1] = val;
        if (field === "测试目的" && next[4]) next[4][1] = val;
        dispatch({ rows: next });
    };

    const setRecord = (idx: number, field: string, val: string) => {
        const next = rows.map((r: any[]) => [...r]);
        const ri = DATA_START + idx;
        if (next[ri]) {
            if (field === "result") next[ri][2] = val;
            if (field === "remark") next[ri][4] = val;
            if (field === "func") next[ri][1] = val;
        }
        dispatch({ rows: next });
    };

    const doSave = () => {
        dispatch({ saving: true });
        const sections = [{ title: "现场测试记录", ref_type: "cover", body: "", tables: [rows], children: [] }];
        Api.update_ftr_record_doc({ id, content: { sections }, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_ftr_record_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) { message.error("导出失败"); }
        finally { dispatch({ exporting: false }); }
    };

    const editCell = (value: string, onChange: (v: string) => void) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", minHeight: 20 }}>{value || ""}</div>
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
            title: "功能模块", dataIndex: "module", width: 120,
            onCell: (_r: any, index?: number) => ({
                rowSpan: moduleSpans[index ?? 0] || 0,
                style: { fontWeight: 600, background: "#fafafa", verticalAlign: "middle" },
            }),
            render: (text: string) => text,
        },
        {
            title: "功能", dataIndex: "func", width: 280,
            render: (text: string, _r: any, idx: number) => editCell(text, (v) => setRecord(idx, "func", v)),
        },
        {
            title: "测试结果", dataIndex: "result", width: 200,
            render: (text: string, _r: any, idx: number) => {
                const val = parseResult(text);
                if (readonly) {
                    return <span style={{ color: val === "pass" ? "#52c41a" : val === "fail" ? "#ff4d4f" : "#999", fontWeight: val ? 600 : 400 }}>
                        {val === "pass" ? "■通过" : val === "fail" ? "■不通过" : "□通过   □不通过"}
                    </span>;
                }
                return (
                    <Radio.Group size="small" value={val} onChange={(e) => setRecord(idx, "result", formatResult(e.target.value))}>
                        <Radio value="pass" style={{ fontSize: 12 }}>通过</Radio>
                        <Radio value="fail" style={{ fontSize: 12 }}>不通过</Radio>
                    </Radio.Group>
                );
            },
        },
        {
            title: "备注", dataIndex: "remark",
            render: (text: string, _r: any, idx: number) => editCell(text, (v) => setRecord(idx, "remark", v)),
        },
    ];

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    现场测试记录
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
                            <Input size="small" style={{ width: 110 }} value={data.doc.version || ""}
                                onChange={(e) => dispatch({ doc: { ...data.doc, version: e.target.value } })} />
                        </span>
                    )}
                </div>
                <Space>
                    {!readonly && <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/ftr_record_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px" }}>
                        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "4px 0 4px" }}>现场测试记录</div>
                        <div style={{ textAlign: "center", color: "#888", marginBottom: 12 }}>{data.doc.file_no || ""}</div>

                        {/* 封面信息 */}
                        <div style={{ maxWidth: 900, marginBottom: 16 }}>
                            <table style={{ borderCollapse: "collapse", width: "100%" }}>
                                <tbody>
                                    <tr>
                                        <td style={labelStyle}>产品名称</td>
                                        <td style={valueStyle}>{editCell(cover["产品名称"] || "", (v) => setCover("产品名称", v))}</td>
                                        <td style={labelStyle}>完整版本号</td>
                                        <td style={valueStyle}>{editCell(cover["完整版本号"] || "", (v) => setCover("完整版本号", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>序列号</td>
                                        <td style={valueStyle}>{editCell(cover["序列号"] || "", (v) => setCover("序列号", v))}</td>
                                        <td style={labelStyle}>测试日期</td>
                                        <td style={valueStyle}>{editCell(cover["测试日期"] || "", (v) => setCover("测试日期", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>测试人员</td>
                                        <td style={valueStyle}>{editCell(cover["测试人员"] || "", (v) => setCover("测试人员", v))}</td>
                                        <td style={labelStyle}>测试目的</td>
                                        <td style={valueStyle}>{editCell(cover["测试目的"] || "", (v) => setCover("测试目的", v))}</td>
                                    </tr>
                                    <tr>
                                        <td style={labelStyle}>测试依据</td>
                                        <td style={valueStyle} colSpan={3}>{editCell(cover["测试依据"] || "", (v) => setCover("测试依据", v))}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        {/* 测试记录列表 */}
                        <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 600, color: "#333" }}>测试项目</div>
                        <Table
                            className="ftr-record-table"
                            columns={columns}
                            dataSource={records}
                            pagination={false}
                            size="small"
                            bordered
                            rowKey="key"
                        />
                    </div>
                </div>
            </Spin>
        </div>
    );
};
