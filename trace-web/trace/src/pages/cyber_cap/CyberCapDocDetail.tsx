import { Button, Input, Select, Space, Spin, message } from "antd";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiCyberCapDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

const ANSWER_OPTIONS = ["是", "否", "不适用", "见注"].map((v) => ({ value: v, label: v }));

// ---- 还原原始 MDS2 表格布局的单元格样式 ----
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500 };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap" };
const barCell: CSSProperties = { ...tdBase, background: "#f0f5ff", fontWeight: 600, color: "#1d39c4" };
const descCell: CSSProperties = { ...tdBase, background: "#fff", color: "#888", fontSize: 12 };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center" };
const seqCell: CSSProperties = { ...tdBase, textAlign: "center", color: "#666", whiteSpace: "nowrap" };
const qCell: CSSProperties = { ...tdBase, color: "#333" };
const subHeaderCell: CSSProperties = { ...tdBase, background: "#f7f7f7", color: "#333", fontWeight: 500 };
const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "fixed" };

// 把题号与问题正文拆开（如 "1-1.2 用户是否..." -> 序号 "1-1.2" + 正文）
const splitSeq = (label: string): { seq: string; text: string } => {
    const m = String(label || "").match(/^(\S+)\s+([\s\S]*)$/);
    return m ? { seq: m[1], text: m[2] } : { seq: "", text: String(label || "") };
};

// 用 schema 默认值 + 已存覆盖值，合成单元格值表
const initCells = (schema: any, saved: Record<string, string>): Record<string, string> => {
    const cells: Record<string, string> = {};
    (schema?.sections || []).forEach((s: any) => {
        (s.items || []).forEach((it: any) => {
            if (it.kind === "qa") {
                cells[it.answer_cell] = it.answer ?? "";
                if (it.note_cell) cells[it.note_cell] = it.note ?? "";
            } else if (it.kind === "remark") {
                cells[it.cell] = it.text ?? "";
            }
        });
    });
    Object.assign(cells, saved || {});
    return cells;
};

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
        auto: {} as any,
        schema: { sections: [] } as any,
        cells: {} as Record<string, string>,
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Promise.all([Api.get_cyber_cap_doc({ id }), Api.cyber_cap_schema()]).then(([docRes, schRes]: any[]) => {
            if (docRes.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(docRes.msg);
                return;
            }
            const doc = docRes.data || {};
            const schema = (schRes.code === Api.C_OK && schRes.data) || { sections: [] };
            const saved = (doc.content && doc.content.cells) || {};
            dispatch({
                loading: false,
                doc,
                auto: doc.auto || {},
                schema,
                cells: initCells(schema, saved),
            });
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

    const setCell = (coord: string, val: string) => {
        dispatch({ cells: { ...data.cells, [coord]: val } });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        Api.cyber_cap_autofill({ product_id: newId }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ auto: res.data || {} });
                if (!res.data?.date) message.warning("该产品未查询到对应时间线，发布日期已清空");
            } else {
                message.error(res.msg);
            }
        });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        Api.update_cyber_cap_doc({
            id,
            content: { cells: data.cells },
            product_id: data.doc.product_id,
            version: data.doc.version,
        }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_cyber_cap_doc({ id });
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
                    网络安全能力分析
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
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    )}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/cyber_cap_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                <div style={{ padding: "12px 20px", maxWidth: 1100 }}>
                    {/* 文档标题（与原模板 B4 一致） */}
                    <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 14px" }}>
                        附件 网络安全能力分析
                    </div>

                    {/* 器械说明 / 制造商联系信息 / 预期用途（按原模板表格布局，自动获取，只读） */}
                    {(() => {
                        const auto = data.auto || {};
                        const contact = `地址：${auto.address || ""}\n电话：${auto.phone || ""}`;
                        return (
                            <table style={tableStyle}>
                                <colgroup>
                                    <col style={{ width: "16%" }} />
                                    <col style={{ width: "34%" }} />
                                    <col style={{ width: "16%" }} />
                                    <col style={{ width: "34%" }} />
                                </colgroup>
                                <tbody>
                                    <tr><td style={barCell} colSpan={4}>器械说明</td></tr>
                                    <tr>
                                        <td style={tdLabel}>器械类别</td><td style={tdValue}>独立软件</td>
                                        <td style={tdLabel}>制造商</td><td style={tdValue}>{auto.registrant || ""}</td>
                                    </tr>
                                    <tr>
                                        <td style={tdLabel}>文件ID</td><td style={tdValue}>{auto.file_no || ""}</td>
                                        <td style={tdLabel}>文件发布日期</td><td style={tdValue}>{auto.date || ""}</td>
                                    </tr>
                                    <tr>
                                        <td style={tdLabel}>器械型号</td><td style={tdValue}>{auto.type_code || ""}</td>
                                        <td style={tdLabel}>软件修订版</td><td style={tdValue}>{auto.full_version || ""}</td>
                                    </tr>
                                    <tr><td style={barCell} colSpan={4}>制造商联系信息</td></tr>
                                    <tr><td style={tdLabel}>公司名称</td><td style={tdValue} colSpan={3}>{auto.registrant || ""}</td></tr>
                                    <tr><td style={tdLabel}>地址 / 电话</td><td style={tdValue} colSpan={3}>{contact}</td></tr>
                                    <tr><td style={tdLabel}>代表姓名/职位</td><td style={tdValue} colSpan={3}>{auto.representative || ""}</td></tr>
                                    <tr><td style={barCell} colSpan={4}>器械在网络连接环境中的预期用途</td></tr>
                                    <tr><td style={tdValue} colSpan={4}>{auto.scope || ""}</td></tr>
                                </tbody>
                            </table>
                        );
                    })()}

                    {/* 各安全能力章节：按原模板表格列（序号 | 问题 | 是/否/不适用 | 注#） */}
                    {(data.schema?.sections || []).map((sec: any, si: number) => (
                        <table key={si} style={tableStyle}>
                            <colgroup>
                                <col style={{ width: 72 }} />
                                <col />
                                <col style={{ width: 130 }} />
                                <col style={{ width: 96 }} />
                            </colgroup>
                            <tbody>
                                <tr><td style={barCell} colSpan={4}>{sec.title}</td></tr>
                                {sec.desc ? <tr><td style={descCell} colSpan={4}>{sec.desc}</td></tr> : null}
                                <tr>
                                    <td style={thCell}>序号</td>
                                    <td style={thCell}>安全能力问题</td>
                                    <td style={thCell}>是/否/不适用/见注</td>
                                    <td style={thCell}>注#</td>
                                </tr>
                                {(sec.items || []).map((it: any, ii: number) => {
                                    if (it.kind === "label") {
                                        return <tr key={ii}><td style={subHeaderCell} colSpan={4}>{it.label}</td></tr>;
                                    }
                                    if (it.kind === "rdmp") {
                                        return (
                                            <tr key={ii}>
                                                <td style={{ ...tdValue, background: "#fafafa" }} colSpan={4}>
                                                    <div style={{ color: "#666", marginBottom: 4 }}>{it.label}</div>
                                                    <div style={{ whiteSpace: "pre-wrap", color: (data.auto || {}).runtime ? "#333" : "#bbb" }}>
                                                        {(data.auto || {}).runtime || "（该产品未配置运行环境，导出将保留模板原文）"}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }
                                    if (it.kind === "remark") {
                                        return (
                                            <tr key={ii}>
                                                <td style={tdValue} colSpan={4}>
                                                    <div style={{ color: "#666", marginBottom: 4 }}>{it.label}</div>
                                                    <Input.TextArea
                                                        autoSize={{ minRows: 1, maxRows: 8 }}
                                                        disabled={readonly}
                                                        value={data.cells[it.cell] ?? ""}
                                                        onChange={(e) => setCell(it.cell, e.target.value)}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    }
                                    const { seq, text } = splitSeq(it.label);
                                    return (
                                        <tr key={ii}>
                                            <td style={seqCell}>{seq}</td>
                                            <td style={qCell}>{text}</td>
                                            <td style={{ ...tdBase, textAlign: "center" }}>
                                                <Select
                                                    size="small"
                                                    style={{ width: "100%" }}
                                                    disabled={readonly}
                                                    options={ANSWER_OPTIONS}
                                                    value={data.cells[it.answer_cell] || undefined}
                                                    onChange={(v) => setCell(it.answer_cell, v)}
                                                />
                                            </td>
                                            <td style={tdBase}>
                                                <Input
                                                    size="small"
                                                    style={{ width: "100%" }}
                                                    placeholder="注#"
                                                    disabled={readonly}
                                                    value={data.cells[it.note_cell] ?? ""}
                                                    onChange={(e) => setCell(it.note_cell, e.target.value)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ))}
                </div>
                </div>
            </Spin>
        </div>
    );
};
