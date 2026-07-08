import { Button, Input, Space, Spin, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiDatDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", tableLayout: "fixed", marginBottom: 12 };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 500, textAlign: "center", whiteSpace: "nowrap" };
const tdValue: CSSProperties = { ...tdBase, color: "#333" };

const DEFAULT: any = {
    project: "", provider: "数据部", quantity: "100", apply_dept: "产品开发部",
    applicant: "宋月", apply_date: "", check_way: "", data_source: "", other: "",
    deliver_date: "", reason: "", sign_img: "", sign_date: "", approve: "",
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const [data, dispatch] = useData({ loading: false, saving: false, exporting: false, doc: {} as any, content: { ...DEFAULT }, products: [] as any[] });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_dat_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) { dispatch({ loading: false }); message.error(res.msg); return; }
            const doc = res.data || {};
            dispatch({ loading: false, doc, content: { ...DEFAULT, ...(doc.content || {}) } });
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
        dispatch({ doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
    };

    const c = data.content || {};
    const set = (k: string, v: string) => dispatch({ content: { ...data.content, [k]: v } });

    const doSave = () => {
        dispatch({ saving: true });
        Api.update_dat_doc({ id, content: data.content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success")); else message.error(res.msg);
        });
    };
    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try { const res: any = await Api.export_dat_doc({ id }); if (res.code !== Api.C_OK) message.error(res.msg || "导出失败"); }
        catch (_e) { message.error("导出失败"); } finally { dispatch({ exporting: false }); }
    };

    const edit = (k: string, opts: any = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap" }}>{c[k] || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 6 }} style={{ padding: 0, fontSize: 13 }} value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...opts} />
    );

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    数据申请单
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
                    <Button onClick={() => navigate("/dat_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: 900 }}>
                        <div style={{ textAlign: "right", color: "#999", marginBottom: 4 }}>{data.doc.file_no || ""}</div>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 12px" }}>数据申请单</div>
                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "18%" }} /><col style={{ width: "32%" }} />
                                <col style={{ width: "18%" }} /><col style={{ width: "32%" }} />
                            </colgroup>
                            <tbody>
                                <tr><td style={tdLabel}>项目名称</td><td style={{ ...tdValue, textAlign: "center" }} colSpan={3}>{edit("project")}</td></tr>
                                <tr><td style={tdLabel}>提供部门</td><td style={tdValue}>{edit("provider")}</td><td style={tdLabel}>数据数量</td><td style={tdValue}>{edit("quantity")}</td></tr>
                                <tr>
                                    <td style={tdLabel}>申请部门</td><td style={tdValue}>{edit("apply_dept")}</td>
                                    <td style={tdLabel}>申请人/日期</td>
                                    <td style={tdValue}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{ flex: "0 0 auto" }}>{edit("applicant")}</div>
                                            <div style={{ flex: 1 }}>{edit("apply_date", { placeholder: "日期" })}</div>
                                        </div>
                                    </td>
                                </tr>
                                <tr><td style={tdLabel} rowSpan={3}>数据需求</td><td style={tdLabel}>检查方式</td><td style={tdValue} colSpan={2}>{edit("check_way")}</td></tr>
                                <tr><td style={tdLabel}>数据来源</td><td style={tdValue} colSpan={2}>{edit("data_source")}</td></tr>
                                <tr><td style={tdLabel}>其他需求</td><td style={tdValue} colSpan={2}>{edit("other")}</td></tr>
                                <tr><td style={tdLabel}>交付日期</td><td style={tdValue} colSpan={3}>{edit("deliver_date")}</td></tr>
                                <tr><td style={tdLabel}>申请原因</td><td style={tdValue} colSpan={3}>{edit("reason")}</td></tr>
                                <tr>
                                    <td style={tdLabel}>申请人签字/日期</td>
                                    <td style={tdValue} colSpan={3}>
                                        {typeof c.sign_img === "string" && c.sign_img.startsWith("data:image") ? (
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                                                <img src={c.sign_img} alt="签字" style={{ height: 40, width: "auto", objectFit: "contain" }} />
                                                {!readonly && <DeleteOutlined title="清除签名" style={{ color: "#c00", cursor: "pointer" }} onClick={() => set("sign_img", "")} />}
                                                <span>{c.sign_date || ""}</span>
                                            </span>
                                        ) : (
                                            <span>{c.applicant || ""}　{c.sign_date || ""}</span>
                                        )}
                                    </td>
                                </tr>
                                <tr><td style={tdValue} colSpan={4}>{edit("approve", { placeholder: "批准意见：                签字/日期：" })}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
