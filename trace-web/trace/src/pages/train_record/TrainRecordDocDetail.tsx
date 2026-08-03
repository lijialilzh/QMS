import { Button, Input, Modal, Space, Spin, message } from "antd";
import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTrainRecordDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

// 培训记录表大表结构（10 行 × 6 列，与 docx 模板一致）：
// 行 0: 培训内容（标题 + 合并的产品/版本/培训范围说明）
// 行 1: 培训时间 | 培训时间 | 培训时间 | (空) | 培训地点 | (值)
// 行 2: 培训人数 | 培训人数 | 培训人数 | (空) | 培训方式 | (值)
// 行 3: 授课老师 | 授课老师 | 授课老师 | (空) | 培训学时 | (值)
// 行 4: 培训人员名单（合并标签行，下方留白填写）
// 行 5: 培训内容摘要（合并标签行，下方留白填写）
// 行 6: 考核方式 | 考核方式 | (值) | (空) | (空) | (空)
// 行 7: 考核人员 | 考核人员 | (值) | (空) | (空) | (空)
// 行 8: 考核结果 | 考核结果 | (值) | (空) | (空) | (空)
// 行 9: 培训评价 | 培训评价 | (值) | (空) | (空) | (空)

const tdStyle: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 8px", fontSize: 12, verticalAlign: "middle" };
const labelStyle: CSSProperties = { ...tdStyle, background: "#fafafa", fontWeight: 600, color: "#555", textAlign: "center" };
const valueStyle: CSSProperties = { ...tdStyle, color: "#333", whiteSpace: "pre-wrap" };
const centerStyle: CSSProperties = { ...tdStyle, textAlign: "center", fontWeight: 600, background: "#fafafa", color: "#555" };

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
        Api.get_train_record_doc({ id }).then((res: any) => {
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

    // 确保表格至少 12 行 × 6 列；兼容旧版 10 行结构（在行4/5标签行后补空白填写行）
    const safeRows = useMemo(() => {
        let src = rows.map((r: any[]) => {
            const row = [...r];
            while (row.length < 6) row.push("");
            return row;
        });
        // 旧版 10 行：行4/5 是标签行，在其后各插入一个空白填写行
        if (src.length === 10) {
            src = src.slice(0, 5) + [["", "", "", "", "", ""]] + src.slice(5);  // 行4后插空白
            src = src.slice(0, 7) + [["", "", "", "", "", ""]] + src.slice(7);  // 行6(原行5)后插空白
        }
        while (src.length < 12) src.push(new Array(6).fill(""));
        return src as any[][];
    }, [rows]);

    const setCell = (ri: number, ci: number, val: string) => {
        const next = safeRows.map((r: any[]) => [...r]);
        if (!next[ri]) next[ri] = new Array(6).fill("");
        next[ri][ci] = val;
        dispatch({ rows: next });
    };

    const doSave = () => {
        dispatch({ saving: true });
        const sections = [{ title: "培训记录表", ref_type: "cover", body: "", tables: [safeRows], children: [] }];
        Api.update_train_record_doc({ id, content: { sections }, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_train_record_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) { message.error("导出失败"); }
        finally { dispatch({ exporting: false }); }
    };

    const editCell = (value: string, ri: number, ci: number, style?: CSSProperties) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", minHeight: 20, ...style }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" size="small" autoSize={{ minRows: 1, maxRows: 6 }}
                style={{ padding: 0, fontSize: 12, ...style }} value={value ?? ""}
                onChange={(e) => setCell(ri, ci, e.target.value)} />
    );

    // 单元格取值助手（直接用行列索引，editCell 负责写回）
    const cell = (ri: number, ci: number) => (safeRows[ri] || [])[ci] || "";

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    培训记录表
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
                    <Button onClick={() => navigate("/train_record_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: 920 }}>
                        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "4px 0" }}>培训记录表</div>
                        <div style={{ textAlign: "center", color: "#888", marginBottom: 12 }}>{data.doc.file_no || ""}</div>

                        <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <tbody>
                                {/* 行 0: 培训内容标题 + 合并的培训范围说明 */}
                                <tr>
                                    <td style={{ ...centerStyle, width: 100 }}>培训内容</td>
                                    <td colSpan={5} style={valueStyle}>
                                        {editCell(cell(0, 1), 0, 1, { minHeight: 60 })}
                                    </td>
                                </tr>
                                {/* 行 1: 培训时间(标签2列) | 值 | 培训地点 | 值(2列) */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>培训时间</td>
                                    <td style={valueStyle}>{editCell(cell(1, 2), 1, 2)}</td>
                                    <td style={{ ...labelStyle, width: 100 }}>培训地点</td>
                                    <td style={valueStyle} colSpan={2}>{editCell(cell(1, 4), 1, 4)}</td>
                                </tr>
                                {/* 行 2: 培训人数(标签2列) | 值 | 培训方式 | 值(2列) */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>培训人数</td>
                                    <td style={valueStyle}>{editCell(cell(2, 2), 2, 2)}</td>
                                    <td style={{ ...labelStyle, width: 100 }}>培训方式</td>
                                    <td style={valueStyle} colSpan={2}>{editCell(cell(2, 4), 2, 4)}</td>
                                </tr>
                                {/* 行 3: 授课老师(标签2列) | 值 | 培训学时 | 值(2列) */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>授课老师</td>
                                    <td style={valueStyle}>{editCell(cell(3, 2), 3, 2)}</td>
                                    <td style={{ ...labelStyle, width: 100 }}>培训学时</td>
                                    <td style={valueStyle} colSpan={2}>{editCell(cell(3, 4), 3, 4)}</td>
                                </tr>
                                {/* 行 4: 培训人员名单 - 标签行（固定） */}
                                <tr>
                                    <td style={{ ...centerStyle }} colSpan={6}>培训人员名单：</td>
                                </tr>
                                {/* 行 5: 培训人员名单 - 填写区（可编辑，存 [0]） */}
                                <tr>
                                    <td colSpan={6} style={{ ...valueStyle, minHeight: 100 }}>
                                        {editCell(cell(5, 0), 5, 0, { minHeight: 100 })}
                                    </td>
                                </tr>
                                {/* 行 6: 培训内容摘要 - 标签行（固定） */}
                                <tr>
                                    <td style={{ ...centerStyle }} colSpan={6}>培训内容摘要：</td>
                                </tr>
                                {/* 行 7: 培训内容摘要 - 填写区（可编辑，存 [0]） */}
                                <tr>
                                    <td colSpan={6} style={{ ...valueStyle, minHeight: 100 }}>
                                        {editCell(cell(7, 0), 7, 0, { minHeight: 100 })}
                                    </td>
                                </tr>
                                {/* 行 8: 考核方式 */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>考核方式</td>
                                    <td style={valueStyle} colSpan={4}>{editCell(cell(8, 2), 8, 2)}</td>
                                </tr>
                                {/* 行 9: 考核人员 */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>考核人员</td>
                                    <td style={valueStyle} colSpan={4}>{editCell(cell(9, 2), 9, 2)}</td>
                                </tr>
                                {/* 行 10: 考核结果 */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>考核结果</td>
                                    <td style={valueStyle} colSpan={4}>{editCell(cell(10, 2), 10, 2)}</td>
                                </tr>
                                {/* 行 11: 培训评价 */}
                                <tr>
                                    <td style={{ ...labelStyle, width: 100 }} colSpan={2}>培训评价</td>
                                    <td style={valueStyle} colSpan={4}>{editCell(cell(11, 2), 11, 2)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};