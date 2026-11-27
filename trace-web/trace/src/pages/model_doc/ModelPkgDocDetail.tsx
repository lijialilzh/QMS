import { syncFileNoVersion } from "@/pages/doc_fill/syncDocVersion";
import { Button, Input, Space, Spin, message } from "antd";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiModelDoc";
import * as ApiProduct from "@/api/ApiProduct";
import { getModelDocMeta, getModelDocListType } from "./ModelDocTypes";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "auto" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "8px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap", textAlign: "center" };

const REQ_CODE = "http://172.16.6.3:8081/model/infearce/";
const REQ_CODE_ROWS = [
    ["1", "图像配准", "imageregistration", `${REQ_CODE}imageregistration`],
    ["2", "肺结节检测", "nodule_detection", `${REQ_CODE}nodule_detection`],
    ["3", "肺结节分割", "nodule_segmentation", `${REQ_CODE}nodule_segmentation`],
    ["4", "结节肺叶肺段定位", "nodule_lobe_train", `${REQ_CODE}nodule_lobe_train`],
    ["5", "肝脏病灶分割", "liverlesion_segmentation", `${REQ_CODE}liverlesion_segmentation`],
    ["6", "肾脏病灶分割", "kidneylesion_segmentation", `${REQ_CODE}kidneylesion_segmentation`],
    ["7", "淋巴结分割", "lymphnode_segmentation", `${REQ_CODE}lymphnode_segmentation`],
];
const REQ_DEFAULT = {
    model_func: REQ_CODE_ROWS.map((row) => row[1]).join("、"),
    param_url: "",
    consistency_url: "",
    consistency_data_url: "http://172.16.6.3:8089/apps/files/?dir=/Model_name/RCN3/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE&fileid=176258",
    code_url: "",
    code_rows: REQ_CODE_ROWS.map((row) => [...row]),
    submitter_sign: "",
    auditor_sign: "",
};

const entryModuleName = (doc: any) => {
    const title = String(doc?.doc_title || "");
    return title.endsWith("封装需求") ? title.slice(0, -4) : "";
};

const oneModuleRow = (name: string, rows: string[][]) => {
    const hit = rows.find((row) => String(row[1] || "").trim() === name);
    if (hit) return [["1", name, hit[2] || "", hit[3] || ""]];
    const sample = REQ_CODE_ROWS.find((row) => row[1] === name);
    if (sample) return [["1", sample[1], sample[2], sample[3]]];
    return [["1", name, "", ""]];
};

const normalizeReq = (raw: any, doc?: any) => {
    const src = raw || {};
    const savedRows = Array.isArray(src.code_rows) && src.code_rows.length
        ? src.code_rows.map((row: any) => (Array.isArray(row) ? row.map((cell: any) => String(cell ?? "")) : ["", "", "", ""]))
        : null;
    const url = String(src.code_url || "");
    const oldUrl = !url || url.endsWith("/pe/pe-segmetation") || url.endsWith("/pe/lobe_segmentation");
    const func = String(src.model_func || "");
    const oldFunc = !func || func === "肺栓塞分割" || func === "肺叶分割" || func === REQ_DEFAULT.model_func;
    let codeRows = savedRows
        || (url && !oldUrl ? [["1", func, "", url]] : REQ_DEFAULT.code_rows.map((row) => [...row]));
    const moduleName = entryModuleName(doc);
    if (moduleName) codeRows = oneModuleRow(moduleName, codeRows);
    const modelFunc = moduleName || func || REQ_DEFAULT.model_func;
    if (savedRows || !oldUrl || !oldFunc || src.consistency_data_url || moduleName) {
        return {
            ...REQ_DEFAULT,
            ...src,
            model_func: modelFunc,
            consistency_data_url: src.consistency_data_url || src.consistency_url || REQ_DEFAULT.consistency_data_url,
            code_rows: codeRows,
        };
    }
    return {
        ...REQ_DEFAULT,
        model_func: modelFunc,
        code_rows: codeRows,
        submitter_sign: src.submitter_sign || "",
        auditor_sign: src.auditor_sign || "",
    };
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
            const content = (!isRec && !isSubmit) ? normalizeReq(doc.content, doc) : { ...fallback, ...(doc.content || {}) };
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
    const codeRows: string[][] = (Array.isArray(c.code_rows) && c.code_rows.length ? c.code_rows : REQ_DEFAULT.code_rows).map((row: any, i: number) => {
        const cells = Array.isArray(row) ? row.map((cell: any) => String(cell ?? "")) : ["", "", "", ""];
        while (cells.length < 4) cells.push("");
        if (!cells[0]) cells[0] = String(i + 1);
        return cells.slice(0, 4);
    });
    const setCodeRows = (rows: string[][]) => setField("code_rows", rows.map((row, i) => [String(i + 1), row[1] || "", row[2] || "", row[3] || ""]));
    const setCodeCell = (ri: number, ci: number, value: string) => {
        setCodeRows(codeRows.map((row, i) => i === ri ? row.map((cell, j) => j === ci ? value : cell) : row));
    };
    const editValue = (value: string, onChange: (v: string) => void, style: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...style }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 8 }} style={{ padding: 0, textAlign: "left", ...style }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const signCell = (value: string, onChange: (v: string) => void) => {
        const raw = String(value || "");
        if (raw.startsWith("data:image")) {
            const [img, rest] = raw.split("\n");
            return (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <img src={img} alt="" style={{ maxHeight: 36 }} />
                    {rest ? <span>{rest}</span> : null}
                </span>
            );
        }
        return editValue(raw, onChange, { textAlign: "center" });
    };

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
                            <Input
                                size="small"
                                style={{ width: 110 }}
                                value={data.doc.version || ""}
                                onChange={(e) => { const version = e.target.value; dispatch({ doc: { ...data.doc, version } }); }}
                            />
                        </span>
                </div>}
                <Space>
                    {!readonly && <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate(`/model_docs/${getModelDocListType(type)}`)}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: isSubmit || isRec ? 960 : 1180 }}>
                        {isSubmit || isRec ? (
                            <>
                                <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>
                                    {isSubmit ? "模型服务提交记录" : "模型工程封装记录"}
                                </div>
                                <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{syncFileNoVersion(data.doc.file_no, data.doc.version) || ""}</div>
                            </>
                        ) : null}

                        <table style={tableStyle}>
                            <colgroup>
                                {isSubmit || isRec ? (
                                    <>
                                        <col style={{ width: isSubmit ? "16%" : "22%" }} />
                                        <col style={{ width: isSubmit ? "18%" : "28%" }} />
                                        <col style={{ width: isSubmit ? "16%" : "22%" }} />
                                        <col style={{ width: isSubmit ? "18%" : "28%" }} />
                                        {isSubmit ? <col style={{ width: "14%" }} /> : null}
                                        {isSubmit ? <col style={{ width: "18%" }} /> : null}
                                    </>
                                ) : (
                                    <>
                                        <col style={{ width: "14%" }} />
                                        <col style={{ width: "8%" }} />
                                        <col style={{ width: "16%" }} />
                                        <col style={{ width: "22%" }} />
                                        <col style={{ width: "40%" }} />
                                    </>
                                )}
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
                                ) : isRec ? (
                                    <>
                                        {spanRow("模型功能", "model_func")}
                                        {spanRow("封装代码地址", "pack_code_url")}
                                        {spanRow("模型参数地址", "param_url")}
                                        {spanRow("一致性测试数据地址", "consistency_data_url")}
                                        {spanRow("一致性结果地址", "consistency_result_url")}
                                        {spanRow("验收结论", "conclusion", true)}
                                        <tr>
                                            <td style={tdLabel}>封装人/日期</td>
                                            <td style={{ ...tdValue, height: 44 }}>
                                                {signCell(c.packer_sign, (v) => setField("packer_sign", v))}
                                            </td>
                                            <td style={tdLabel}>审核人/日期</td>
                                            <td style={{ ...tdValue, height: 44 }}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
                                        </tr>
                                    </>
                                ) : (
                                    <>
                                        <tr>
                                            <td colSpan={5} style={{ ...tdLabel, fontWeight: 700, fontSize: 16, color: "#222", background: "#fff", position: "relative", textAlign: "center" }}>
                                                模型工程封装需求
                                                <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 600, color: "#333" }}>
                                                    {syncFileNoVersion(data.doc.file_no, data.doc.version) || ""}
                                                </span>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>模型功能</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={4}>{c.model_func || ""}</td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel} rowSpan={codeRows.length + 1}>待封装代码地址</td>
                                            {["序号", "模块", "模型名称", "代码地址"].map((head) => (
                                                <td key={head} style={tdLabel}>{head}</td>
                                            ))}
                                        </tr>
                                        {codeRows.map((row, ri) => (
                                            <tr key={ri}>
                                                <td style={{ ...tdValue, width: 56 }}>{row[0]}</td>
                                                <td style={tdValue}>{row[1]}</td>
                                                <td style={tdValue}>{editValue(row[2], (v) => setCodeCell(ri, 2, v))}</td>
                                                <td style={{ ...tdValue, textAlign: "left" }}>{editValue(row[3], (v) => setCodeCell(ri, 3, v))}</td>
                                            </tr>
                                        ))}
                                        <tr>
                                            <td style={tdLabel}>一致性测试数据地址</td>
                                            <td style={{ ...tdValue, textAlign: "left" }} colSpan={4}>
                                                {editValue(c.consistency_data_url || "", (v) => setField("consistency_data_url", v))}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style={tdLabel}>提交人/日期</td>
                                            <td style={{ ...tdValue, height: 44 }}>{signCell(c.submitter_sign, (v) => setField("submitter_sign", v))}</td>
                                            <td style={tdLabel}>审核人/日期</td>
                                            <td style={{ ...tdValue, height: 44 }} colSpan={2}>{signCell(c.auditor_sign, (v) => setField("auditor_sign", v))}</td>
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
