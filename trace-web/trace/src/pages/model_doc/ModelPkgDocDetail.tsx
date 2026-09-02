import { Button, Input, Space, Spin, message } from "antd";
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
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "8px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap", textAlign: "center" };

const REQ_DEFAULT = {
    model_func: "",
    param_url: "",
    consistency_url: "",
    code_url: "",
    submitter_sign: "",
    auditor_sign: "",
};

const REC_DEFAULT = {
    model_func: "",
    pack_code_url: "",
    param_url: "",
    consistency_data_url: "",
    consistency_result_url: "",
    conclusion: "",
    packer_sign: "",
    auditor_sign: "",
};

const SUBMIT_DEFAULT = {
    author: "",
    write_date: "",
    auditor: "",
    model_func: "",
    submit_model: "",
    test_conclusion: "",
    code_url: "",
    param_url: "",
    consistency_data_url: "",
    consistency_result_url: "",
    author_sign: "",
    auditor_sign: "",
    approver_sign: "",
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id, type } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const meta = getModelDocMeta(type);
    const isRec = type === "md_016";
    const isSubmit = type === "md_018";
    const fallback = isSubmit ? SUBMIT_DEFAULT : (isRec ? REC_DEFAULT : REQ_DEFAULT);
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        content: { ...fallback } as any,
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
            dispatch({ loading: false, doc, content: { ...fallback, ...(doc.content || {}) } });
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

    const doSave = () => {
        dispatch({ saving: true });
        Api.update_model_doc({ id, content: data.content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
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
    const editValue = (value: string, onChange: (v: string) => void, style: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...style }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 8 }} style={{ padding: 0, textAlign: "left", ...style }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const signCell = (value: string, onChange: (v: string) => void) => (
        String(value || "").startsWith("data:image")
            ? <img src={value} alt="" style={{ maxHeight: 36 }} />
            : editValue(value, onChange, { textAlign: "center" })
    );

    const spanRow = (label: string, key: string, center = false) => (
        <tr>
            <td style={tdLabel}>{label}</td>
            <td style={{ ...tdValue, textAlign: center ? "center" : "left" }} colSpan={3}>
                {editValue(c[key], (v) => setField(key, v), { textAlign: center ? "center" : "left" })}
            </td>
        </tr>
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
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>
                            {isSubmit ? "模型服务提交记录" : (isRec ? "模型工程封装记录" : "模型工程封装需求")}
                        </div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: isSubmit ? "16%" : "22%" }} />
                                <col style={{ width: isSubmit ? "18%" : "28%" }} />
                                <col style={{ width: isSubmit ? "16%" : "22%" }} />
                                <col style={{ width: isSubmit ? "18%" : "28%" }} />
                                {isSubmit ? <col style={{ width: "14%" }} /> : null}
                                {isSubmit ? <col style={{ width: "18%" }} /> : null}
                            </colgroup>
                            <tbody>
                                {isSubmit ? (
                                    <>
                                        <tr>
                                            <td style={tdLabel}>编写人</td>
                                            <td style={tdValue}>{editValue(c.author, (v) => setField("author", v), { textAlign: "center" })}</td>
                                            <td style={tdLabel}>编写日期</td>
                                            <td style={tdValue}>{editValue(c.write_date, (v) => setField("write_date", v), { textAlign: "center" })}</td>
                                            <td style={tdLabel}>审核人</td>
                                            <td style={tdValue}>{editValue(c.auditor, (v) => setField("auditor", v), { textAlign: "center" })}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>功能</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.model_func, (v) => setField("model_func", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>提交模型</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.submit_model, (v) => setField("submit_model", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>模型测试结论</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.test_conclusion, (v) => setField("test_conclusion", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>模型代码地址</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.code_url, (v) => setField("code_url", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>模型参数地址</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.param_url, (v) => setField("param_url", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>一致性测试数据地址</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.consistency_data_url, (v) => setField("consistency_data_url", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>一致性结果地址</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={5}>{editValue(c.consistency_result_url, (v) => setField("consistency_result_url", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>编写人（签字）/日期</td>
                                            <td style={{ ...tdValue, height: 44 }} colSpan={5}>{signCell(c.author_sign, (v) => setField("author_sign", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>审核人（签字）/日期</td>
                                            <td style={{ ...tdValue, height: 44 }} colSpan={5}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>批准人（签字）/日期</td>
                                            <td style={{ ...tdValue, height: 44 }} colSpan={5}>{signCell(c.approver_sign, (v) => setField("approver_sign", v))}</td>
                                        </tr>
                                    </>
                                ) : (
                                    <>
                                        {spanRow("模型功能", "model_func")}
                                        {isRec ? spanRow("封装代码地址", "pack_code_url") : null}
                                        {spanRow("模型参数地址", "param_url")}
                                        {isRec ? spanRow("一致性测试数据地址", "consistency_data_url") : spanRow("一致性测试结果", "consistency_url")}
                                        {isRec ? spanRow("一致性结果地址", "consistency_result_url") : spanRow("待封装代码地址", "code_url")}
                                        {isRec ? spanRow("验收结论", "conclusion", true) : null}
                                        <tr>
                                            <td style={tdLabel}>{isRec ? "封装人/日期" : "提交人/日期"}</td>
                                            <td style={{ ...tdValue, height: 44 }}>
                                                {signCell(isRec ? c.packer_sign : c.submitter_sign, (v) => setField(isRec ? "packer_sign" : "submitter_sign", v))}
                                            </td>
                                            <td style={tdLabel}>审核人/日期</td>
                                            <td style={{ ...tdValue, height: 44 }}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
                                        </tr>
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
