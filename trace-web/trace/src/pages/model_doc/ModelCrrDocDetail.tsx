import { Button, Checkbox, Input, Space, Spin, message } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiModelDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiPersonSign from "@/api/ApiPersonSign";
import { getModelDocMeta } from "./ModelDocTypes";
import "../pdp/PdpDocDetail.less";

const CATEGORIES = ["结构", "文档", "变量", "算法操作", "循环和分支"];
const CONCLUSIONS = ["通过", "有条件通过", "不通过"];
const isCategory = (row: any[]) =>
    Array.isArray(row) && CATEGORIES.includes(String(row[0] ?? "").trim())
    && row.slice(1).every((c: any) => !String(c ?? "").trim());

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle" };
const tdLabel: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", whiteSpace: "nowrap", fontWeight: 500, textAlign: "center" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap" };
const barCell: CSSProperties = { ...tdBase, background: "#f0f5ff", fontWeight: 600, color: "#1d39c4" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center" };
const seqCell: CSSProperties = { ...tdBase, textAlign: "center", color: "#666", whiteSpace: "nowrap" };

const DEFAULT_CONTENT = {
    code_url: "",
    check_date: "",
    auditee: "",
    auditor: "",
    basis: "《代码管理制度》",
    method: "代码审查",
    checklist: [["编号", "问题", "是", "否", "不适用", "备注"]],
    conclusion: "",
    sign_img: "",
    sign_date: "",
};

const computeFileDate = (rows: any[], keywords: string[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const kws = (keywords || []).filter(Boolean);
    const matches = (rows || []).filter((r: any) =>
        (r.row_type || "date") === "date" && Object.values(r.cells || {}).some((v: any) => {
            const s = String(v || "");
            return kws.some((k) => s.includes(k));
        })
    );
    if (!matches.length) return "";
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) < key(best)) best = r; });
    return `${num(best.year)}.${Number(best.month)}.${Number(best.day)}`;
};

const memberNames = (members: any[], pred: (role: string) => boolean): string[] =>
    (members || []).map((m: any) => ({ role: String(m.role || "").trim(), name: String(m.name || "").trim() }))
        .filter((m) => m.name && pred(m.role))
        .map((m) => m.name);

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

    const applyPeople = (content: any, productId: number): Promise<any> =>
        new Promise((resolve) => {
            if (!productId) { resolve(content); return; }
            Promise.all([
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiPersonSign.list_person_sign({ page_index: 0, page_size: 1000 }).catch(() => null),
            ]).then(([tl, mb, ps]: any[]) => {
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const signRows = ps && ps.code === Api.C_OK ? ((ps.data && ps.data.rows) || []) : [];
                const signMap: Record<string, string> = {};
                signRows.forEach((s: any) => { if (s.name && s.sign_img) signMap[String(s.name).trim()] = s.sign_img; });
                const date = computeFileDate(tlRows, meta.keywords.concat(meta.title));
                const auditee = memberNames(members, (r) => r === "算法工程师").join(" ");
                const auditor = memberNames(members, (r) => r === "高级算法工程师").join(" ");
                const firstAuditor = memberNames(members, (r) => r === "高级算法工程师")[0] || "";
                resolve({
                    ...content,
                    check_date: date,
                    sign_date: date,
                    auditee,
                    auditor,
                    sign_img: (firstAuditor && signMap[firstAuditor]) || auditor || "",
                });
            }).catch(() => resolve(content));
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
            if (!Array.isArray(content.checklist) || !content.checklist.length) {
                content.checklist = DEFAULT_CONTENT.checklist;
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
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        applyPeople(data.content, newId).then((content) => dispatch({ loading: false, content }));
    };

    const setField = (key: string, value: any) => {
        dispatch({ content: { ...data.content, [key]: value } });
    };

    const setCell = (r: number, c: number, value: string) => {
        const checklist = (data.content.checklist || []).map((row: any[], ri: number) =>
            ri === r ? row.map((cell: any, ci: number) => (ci === c ? value : cell)) : row
        );
        dispatch({ content: { ...data.content, checklist } });
    };

    const MARK = "√";
    const toggleMark = (r: number, col: number) => {
        const checklist = (data.content.checklist || []).map((row: any[], ri: number) => {
            if (ri !== r) return row;
            const next = [...row];
            const checked = String(next[col] ?? "").trim() !== "";
            [2, 3, 4].forEach((ci) => { next[ci] = ""; });
            if (!checked) next[col] = MARK;
            return next;
        });
        dispatch({ content: { ...data.content, checklist } });
    };
    const isChecked = (row: any[], col: number) => String(row[col] ?? "").trim() !== "";

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
    const checklist: any[][] = Array.isArray(c.checklist) ? c.checklist : [];
    const cols = 6;

    const editValue = (value: string, onChange: (v: string) => void, style: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...style }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 10 }} style={{ padding: 0, ...style }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );
    const editMark = (value: string, onChange: (v: string) => void) => (
        readonly
            ? <div style={{ textAlign: "center" }}>{value || ""}</div>
            : <Input variant="borderless" style={{ textAlign: "center", padding: 0 }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
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
                    <div style={{ padding: "12px 20px", maxWidth: 1000 }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>{meta.title}</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "42%" }} />
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "26%" }} />
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>代码地址</td>
                                    <td style={{ ...tdValue, textAlign: "left", verticalAlign: "top" }}>{editValue(c.code_url, (v) => setField("code_url", v), { textAlign: "left" })}</td>
                                    <td style={tdLabel}>检查日期</td>
                                    <td style={tdValue}>{editValue(c.check_date, (v) => dispatch({ content: { ...data.content, check_date: v, sign_date: v } }))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>被审核人</td>
                                    <td style={tdValue}>{editValue(c.auditee, (v) => setField("auditee", v))}</td>
                                    <td style={tdLabel}>审核人</td>
                                    <td style={tdValue}>{editValue(c.auditor, (v) => setField("auditor", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>审核依据</td>
                                    <td style={tdValue} colSpan={3}>{editValue(c.basis, (v) => setField("basis", v))}</td>
                                </tr>
                                <tr>
                                    <td style={tdLabel}>审核方式</td>
                                    <td style={tdValue} colSpan={3}>{editValue(c.method, (v) => setField("method", v))}</td>
                                </tr>
                            </tbody>
                        </table>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: 64 }} />
                                <col />
                                <col style={{ width: 70 }} />
                                <col style={{ width: 70 }} />
                                <col style={{ width: 80 }} />
                                <col style={{ width: 160 }} />
                            </colgroup>
                            <tbody>
                                {checklist.map((row, r) => {
                                    if (r === 0) {
                                        return (
                                            <tr key={r}>
                                                {row.map((cell: any, ci: number) => (
                                                    <td key={ci} style={thCell}>{cell}</td>
                                                ))}
                                            </tr>
                                        );
                                    }
                                    if (isCategory(row)) {
                                        return (
                                            <tr key={r}>
                                                <td style={barCell} colSpan={cols}>{row[0]}</td>
                                            </tr>
                                        );
                                    }
                                    return (
                                        <tr key={r}>
                                            <td style={seqCell}>{editMark(String(row[0] ?? ""), (v) => setCell(r, 0, v))}</td>
                                            <td style={tdValue}>{editValue(String(row[1] ?? ""), (v) => setCell(r, 1, v))}</td>
                                            <td style={{ ...tdBase, textAlign: "center" }}><Checkbox checked={isChecked(row, 2)} disabled={readonly} onChange={() => toggleMark(r, 2)} /></td>
                                            <td style={{ ...tdBase, textAlign: "center" }}><Checkbox checked={isChecked(row, 3)} disabled={readonly} onChange={() => toggleMark(r, 3)} /></td>
                                            <td style={{ ...tdBase, textAlign: "center" }}><Checkbox checked={isChecked(row, 4)} disabled={readonly} onChange={() => toggleMark(r, 4)} /></td>
                                            <td style={tdValue}>{editValue(String(row[5] ?? ""), (v) => setCell(r, 5, v))}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        <table style={tableStyle}>
                            <tbody>
                                <tr><td style={barCell}>结论</td></tr>
                                <tr>
                                    <td style={tdValue}>
                                        {CONCLUSIONS.map((name) => (
                                            <Checkbox
                                                key={name}
                                                checked={String(c.conclusion || "") === name}
                                                disabled={readonly}
                                                onChange={() => setField("conclusion", String(c.conclusion || "") === name ? "" : name)}
                                                style={{ marginRight: 16 }}
                                            >
                                                {name}
                                            </Checkbox>
                                        ))}
                                    </td>
                                </tr>
                            </tbody>
                        </table>

                        <table style={tableStyle}>
                            <colgroup>
                                <col style={{ width: "24%" }} />
                                <col />
                                <col style={{ width: "24%" }} />
                            </colgroup>
                            <tbody>
                                <tr>
                                    <td style={tdLabel}>审核人（签字）/日期</td>
                                    <td style={{ ...tdBase, textAlign: "center" }}>
                                        {typeof c.sign_img === "string" && c.sign_img.startsWith("data:image") ? (
                                            <span style={{ position: "relative", display: "inline-block" }}>
                                                <img src={c.sign_img} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                {!readonly && (
                                                    <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setField("sign_img", "")} />
                                                )}
                                            </span>
                                        ) : (
                                            <span>{c.auditor || ""}</span>
                                        )}
                                    </td>
                                    <td style={{ ...tdBase, textAlign: "center" }}>{c.sign_date || c.check_date || ""}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </Spin>
        </div>
    );
};
