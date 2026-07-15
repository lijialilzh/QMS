import { Button, Checkbox, Input, Space, Spin, message } from "antd";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiTemDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../pdp/PdpDocDetail.less";

// 检查表分组表头（与后端 serv_tem_doc 保持一致）
const SERVER_GROUPS = [
    { label: "日期", leaves: [] as string[] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "数据库\n运行是否正常", "应用服务\n运行是否正常"] },
    { label: "测试环境\n是否更新升级", leaves: [] },
    { label: "服务器\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "测试工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "服务器\n是否备份", leaves: [] },
    { label: "服务器\n日志是否错误", leaves: [] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const DEV_GROUPS = [
    { label: "日期", leaves: [] as string[] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "浏览器\n运行是否正常"] },
    { label: "测试环境\n是否更新升级", leaves: [] },
    { label: "测试机\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "测试工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const GROUPS: any = { server: SERVER_GROUPS, dev: DEV_GROUPS };

type LeafCol = { label: string; type: "date" | "check" | "problem" | "checker" };
const leafCols = (kind: string): LeafCol[] => {
    const out: LeafCol[] = [];
    (GROUPS[kind] || DEV_GROUPS).forEach((g: any) => {
        if (g.leaves.length) {
            g.leaves.forEach((lf: string) => out.push({ label: lf, type: "check" }));
        } else {
            const t = g.label === "日期" ? "date"
                : g.label.startsWith("出现的问题") ? "problem"
                    : g.label === "检查人" ? "checker" : "check";
            out.push({ label: g.label, type: t });
        }
    });
    return out;
};

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 8, tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 6px", fontSize: 12, verticalAlign: "middle" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap" };
const barCell: CSSProperties = { ...tdBase, background: "#f0f5ff", fontWeight: 600, color: "#1d39c4", textAlign: "center" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center", whiteSpace: "pre-line" };
const seqCell: CSSProperties = { ...tdBase, textAlign: "center", color: "#666", whiteSpace: "pre-line", minWidth: 92 };

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
        content: { desc: "", assets: [], checks: [] } as any,
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_tem_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            dispatch({ loading: false, doc, content: doc.content || { desc: "", assets: [], checks: [] } });
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

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        // 切换产品后重新获取该产品对应的自动填充内容
        Api.refresh_content({ product_id: newId }).then((res: any) => {
            if (res.code === Api.C_OK && res.data) {
                dispatch({ content: res.data });
            }
        });
    };

    const clone = () => JSON.parse(JSON.stringify(data.content || {}));

    const setAsset = (r: number, c: number, v: string) => {
        const next = clone();
        next.assets[r][c] = v;
        dispatch({ content: next });
    };
    const setMark = (ci: number, ri: number, j: number, val: string) => {
        const next = clone();
        const marks = next.checks[ci].rows[ri].marks || [];
        marks[j] = marks[j] === val ? "" : val;
        next.checks[ci].rows[ri].marks = marks;
        dispatch({ content: next });
    };
    const setRowField = (ci: number, ri: number, field: string, v: string) => {
        const next = clone();
        next.checks[ci].rows[ri][field] = v;
        dispatch({ content: next });
    };

    const doSave = () => {
        dispatch({ saving: true });
        Api.update_tem_doc({ id, content: data.content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_tem_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const editText = (value: string, onChange: (v: string) => void, extra: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...extra }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 6 }} style={{ padding: 0, fontSize: 12, ...extra }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const c = data.content || {};
    const assets: any[][] = Array.isArray(c.assets) ? c.assets : [];
    const checks: any[] = Array.isArray(c.checks) ? c.checks : [];

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    测试环境维护记录
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
                    <Button onClick={() => navigate("/tem_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px" }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 12px" }}>测试环境维护记录</div>
                        <div style={{ color: "#888", marginBottom: 4 }}>{data.doc.file_no || ""}</div>

                        {/* 资产表 */}
                        <div style={{ color: "#888", margin: "16px 0 4px" }}>测试环境维护记录 · 资产</div>
                        <table style={{ ...tableStyle, maxWidth: 1000 }}>
                            <colgroup>
                                <col style={{ width: "16%" }} />
                                <col style={{ width: "48%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "18%" }} />
                            </colgroup>
                            <tbody>
                                {assets.map((row, r) => (
                                    <tr key={r}>
                                        {row.map((cell: any, ci: number) => (
                                            <td key={ci} style={r === 0 ? thCell : (ci === 1 ? tdValue : { ...tdValue, textAlign: "center" })}>
                                                {r === 0 ? cell : editText(String(cell ?? ""), (v) => setAsset(r, ci, v))}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* 说明正文（默认内容，只读不可编辑；标题加粗）——位于资产表下方 */}
                        <div style={{ color: "#888", margin: "16px 0 4px" }}>说明（默认内容，不可编辑）</div>
                        <div style={{ border: "1px solid #eee", background: "#fafafa", borderRadius: 4, padding: "10px 12px", lineHeight: 1.7, color: "#333", fontSize: 13 }}>
                            {String(c.desc ?? "").split("\n").map((ln: string, i: number) => {
                                const t = ln.trim();
                                const isHead = t === "开发/测试环境定期验证" || /^[一二三四五六七八九十]：/.test(t);
                                return <div key={i} style={{ whiteSpace: "pre-wrap", fontWeight: isHead ? 700 : 400, marginTop: isHead ? 8 : 0 }}>{ln || "\u00a0"}</div>;
                            })}
                        </div>

                        {/* 各资产周检查表 */}
                        {checks.map((chk, ci) => {
                            const kind = chk.kind || "dev";
                            const groups = GROUPS[kind] || DEV_GROUPS;
                            const cols = leafCols(kind);
                            const ncols = cols.length;
                            const code = (assets.find((a: any[]) => String(a[0]).trim() === String(chk.asset).trim())?.[0]) ?? (chk.asset || "");
                            const title = `测试共用-${kind === "server" ? "服务器" : "测试机"}检查表（${code}）`;
                            const rows: any[] = Array.isArray(chk.rows) ? chk.rows : [];
                            return (
                                <div key={ci} style={{ marginTop: 16, overflowX: "auto" }}>
                                    <table style={{ ...tableStyle, minWidth: 1100, tableLayout: "auto" }}>
                                        <tbody>
                                            <tr><td colSpan={ncols} style={barCell}>{title}</td></tr>
                                            <tr>
                                                {groups.map((g: any, gi: number) => {
                                                    const extra: any = g.label === "检查人" ? { minWidth: 120 }
                                                        : g.label.startsWith("出现的问题") ? { width: 130, minWidth: 100, maxWidth: 140 } : {};
                                                    return g.leaves.length
                                                        ? <td key={gi} colSpan={g.leaves.length} style={thCell}>{g.label}</td>
                                                        : <td key={gi} rowSpan={2} style={{ ...thCell, ...extra }}>{g.label}</td>;
                                                })}
                                            </tr>
                                            <tr>
                                                {groups.flatMap((g: any, gi: number) =>
                                                    g.leaves.map((lf: string, li: number) => <td key={`${gi}-${li}`} style={thCell}>{lf}</td>)
                                                )}
                                            </tr>
                                            {rows.length === 0 ? (
                                                <tr><td colSpan={ncols} style={{ ...tdValue, textAlign: "center", color: "#bbb" }}>该产品未查询到「测试~测试」时间线，暂无周记录</td></tr>
                                            ) : rows.map((row, ri) => {
                                                let checkIdx = -1;
                                                const marks = row.marks || [];
                                                return (
                                                    <tr key={ri}>
                                                        {cols.map((col, idx) => {
                                                            if (col.type === "date") return <td key={idx} style={seqCell}>{String(row.date || "").replace("- ", "-\n")}</td>;
                                                            if (col.type === "problem") return <td key={idx} style={{ ...tdValue, width: 130, minWidth: 100, maxWidth: 140, textAlign: "center" }}>{editText(String(row.problem ?? ""), (v) => setRowField(ci, ri, "problem", v), { textAlign: "center" })}</td>;
                                                            if (col.type === "checker") {
                                                                const ck = String(row.checker ?? "");
                                                                return (
                                                                    <td key={idx} style={{ ...tdValue, textAlign: "center", minWidth: 130 }}>
                                                                        {ck.startsWith("data:image")
                                                                            ? <img src={ck} alt="检查人" style={{ height: 42, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
                                                                            : editText(ck, (v) => setRowField(ci, ri, "checker", v))}
                                                                    </td>
                                                                );
                                                            }
                                                            checkIdx += 1;
                                                            const cj = checkIdx;
                                                            const mk = String(marks[cj] ?? "");
                                                            return (
                                                                <td key={idx} style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap" }}>
                                                                    <div style={{ lineHeight: "22px" }}>
                                                                        <Checkbox checked={mk === "是"} disabled={readonly} onChange={() => setMark(ci, ri, cj, "是")} style={{ transform: "scale(0.8)" }} />
                                                                        <span style={{ marginLeft: "2em", fontSize: 13 }}>是</span>
                                                                    </div>
                                                                    <div style={{ lineHeight: "22px" }}>
                                                                        <Checkbox checked={mk === "否"} disabled={readonly} onChange={() => setMark(ci, ri, cj, "否")} style={{ transform: "scale(0.8)" }} />
                                                                        <span style={{ marginLeft: "2em", fontSize: 13 }}>否</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Spin>
        </div>
    );
};