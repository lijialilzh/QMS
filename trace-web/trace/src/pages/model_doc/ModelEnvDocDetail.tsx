import { Button, Checkbox, Input, Space, Spin, message } from "antd";
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
import {
    buildEnvCheckTable, collectAssetCodes, computeDevTestWeeks, envCheckGroups, envCheckLeafCols,
    envCheckTitle, isEnvCheckGrid, parseEqAssets, prevEnvCheckRows,
} from "./envMaintCheck";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 8, tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 6px", fontSize: 12, verticalAlign: "middle" };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap" };
const barCell: CSSProperties = { ...tdBase, background: "#f0f5ff", fontWeight: 600, color: "#1d39c4", textAlign: "center" };
const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center", whiteSpace: "pre-line" };
const seqCell: CSSProperties = { ...tdBase, textAlign: "center", color: "#666", whiteSpace: "pre-line", minWidth: 92 };

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();
const stripKeys = (nodes: any[]): any[] =>
    (nodes || []).map(({ _key, ...rest }: any) => ({ ...rest, children: stripKeys(rest.children || []) }));
const memberNames = (members: any[], pred: (role: string) => boolean): string[] =>
    (members || []).map((m: any) => ({ role: String(m.role || "").trim(), name: String(m.name || "").trim() }))
        .filter((m) => m.name && pred(m.role))
        .map((m) => m.name);

const inspectTitle = (docType: string) => (docType === "md_020" ? "测试环境定期检查" : "开发环境定期检查");
const maintTitle = (docType: string) => (docType === "md_020" ? "测试环境维护记录" : "开发环境维护记录");

const findByTitle = (nodes: any[], title: string): any => {
    for (const n of nodes || []) {
        if (stripNum(n.title) === title) return n;
        const hit = findByTitle(n.children || [], title);
        if (hit) return hit;
    }
    return null;
};

const mapByTitle = (nodes: any[], title: string, fn: (n: any) => any): any[] =>
    (nodes || []).map((n: any) => (stripNum(n.title) === title ? fn(n) : { ...n, children: mapByTitle(n.children || [], title, fn) }));

const ensureEnvMaintChapter = (nodes: any[], docType: string): any[] => {
    const want = maintTitle(docType);
    const after = inspectTitle(docType);
    if (findByTitle(nodes, want)) return nodes;
    const node = { title: want, body: "", tables: [], children: [] };
    const idx = (nodes || []).findIndex((n: any) => stripNum(n.title) === after);
    if (idx >= 0) {
        const next = [...nodes];
        next.splice(idx + 1, 0, node);
        return next;
    }
    return [...(nodes || []), node];
};

const fillEnvMaint = (nodes: any[], opts: {
    prodName: string; fullVersion: string; weeks: string[];
    checker: string; eqAssets: { code: string; usage: string }[] | null; docType: string;
}): any[] => {
    const want = maintTitle(opts.docType);
    const fillAsset = (tb: any[]): any[] => {
        if (!Array.isArray(tb) || !Array.isArray(tb[0])) return tb;
        const hdr = tb[0].map((h: any) => String(h || ""));
        if (String(hdr[0] || "").trim() !== "资产编码" || !hdr.some((h: string) => h.includes("设备信息"))) return tb;
        const old: Record<string, string> = {};
        tb.slice(1).forEach((row: any[]) => {
            if (!Array.isArray(row)) return;
            const code = String(row[0] || "").trim();
            if (code) old[code] = String(row[1] || "");
        });
        if (opts.eqAssets !== null) {
            const header = hdr.length >= 4 ? hdr.slice(0, 4) : ["资产编码", "设备信息", "产品名称", "完整版本"];
            return [header, ...opts.eqAssets.map((a) => [a.code, old[a.code] || "", opts.prodName, opts.fullVersion])];
        }
        return tb.map((row: any[], i: number) => {
            if (i === 0 || !Array.isArray(row)) return row;
            const next = [...row];
            while (next.length < 4) next.push("");
            next[2] = opts.prodName;
            next[3] = opts.fullVersion;
            return next;
        });
    };
    const withAssets = (nodes || []).map(function fix(n: any): any {
        let tables = n.tables;
        if (Array.isArray(tables)) tables = tables.map((tb: any[]) => (Array.isArray(tb) ? fillAsset(tb) : tb));
        return { ...n, tables, children: (n.children || []).map(fix) };
    });
    const oldByAsset: Record<string, Record<string, string[]>> = {};
    const collectOld = (ns: any[]) => {
        (ns || []).forEach((n: any) => {
            (n.tables || []).forEach((tb: any[]) => {
                if (!isEnvCheckGrid(tb)) return;
                oldByAsset[String(tb[0][2] || "")] = prevEnvCheckRows(tb);
            });
            collectOld(n.children || []);
        });
    };
    collectOld(withAssets);
    const assets = opts.eqAssets !== null ? opts.eqAssets : collectAssetCodes(withAssets);
    const checks = assets.map((a) => buildEnvCheckTable(opts.docType, a, opts.weeks || [], opts.checker, oldByAsset[a.code] || {}));
    return withAssets.map(function fix(n: any): any {
        const tables = stripNum(n.title) === want ? checks : n.tables;
        return { ...n, tables, children: (n.children || []).map(fix) };
    });
};

const isAssetGrid = (tb: any[]): boolean => {
    if (!Array.isArray(tb) || !Array.isArray(tb[0])) return false;
    const hdr = tb[0].map((h: any) => String(h || ""));
    return String(hdr[0] || "").trim() === "资产编码" && hdr.some((h: string) => h.includes("设备信息"));
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id, type } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const docType = type === "md_020" ? "md_020" : "md_019";
    const title = getModelDocMeta(docType).title;
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        sections: [] as any[],
        products: [] as any[],
    });

    const applyEnv = (productId: number, secs: any[]): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiPersonSign.list_person_sign({ page_index: 0, page_size: 1000 }).catch(() => null),
                Api.list_model_doc({ product_id: productId, doc_type: docType === "md_019" ? "md_deq" : "md_teq", page_index: 0, page_size: 1 }).catch(() => null),
            ]).then(([pr, tl, mb, ps, eqList]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const signRows = ps && ps.code === Api.C_OK ? ((ps.data && ps.data.rows) || []) : [];
                const signMap: Record<string, string> = {};
                signRows.forEach((s: any) => { if (s.name && s.sign_img) signMap[String(s.name).trim()] = s.sign_img; });
                const checkerName = memberNames(members, (r) => r === "模型部负责人")[0]
                    || memberNames(members, (r) => r === "模型负责人")[0]
                    || "";
                const eqDoc = eqList && eqList.code === Api.C_OK ? (((eqList.data && eqList.data.rows) || [])[0] || null) : null;
                let out = ensureEnvMaintChapter(secs, docType);
                out = fillEnvMaint(out, {
                    prodName: String(prod.name || "").trim(),
                    fullVersion: String(prod.full_version || "").trim(),
                    weeks: computeDevTestWeeks(tlRows),
                    checker: (checkerName && signMap[checkerName]) || checkerName || "",
                    eqAssets: eqDoc ? parseEqAssets(eqDoc.content) : null,
                    docType,
                });
                resolve(out);
            }).catch(() => resolve(secs));
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
            const secs = (doc.content && doc.content.sections) || [];
            applyEnv(doc.product_id, secs).then((next) => {
                dispatch({ loading: false, doc, sections: next });
            });
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
        applyEnv(newId, data.sections).then((secs) => dispatch({ loading: false, sections: secs }));
    };

    const inspect = findByTitle(data.sections, inspectTitle(docType));
    const maint = findByTitle(data.sections, maintTitle(docType));
    const assets: any[][] = (inspect?.tables || []).find((tb: any[]) => isAssetGrid(tb)) || [];
    const desc = String(inspect?.body || "");
    const checks: any[][] = (maint?.tables || []).filter((tb: any[]) => isEnvCheckGrid(tb));

    const setSections = (sections: any[]) => dispatch({ sections });

    const setAsset = (r: number, c: number, v: string) => {
        setSections(mapByTitle(data.sections, inspectTitle(docType), (n: any) => {
            const tables = (n.tables || []).map((tb: any[]) => {
                if (!isAssetGrid(tb) || !Array.isArray(tb[r])) return tb;
                return tb.map((row: any[], ri: number) => (ri === r ? row.map((cell: any, ci: number) => (ci === c ? v : cell)) : row));
            });
            return { ...n, tables };
        }));
    };

    const setEnvCell = (ti: number, r: number, c: number, v: string) => {
        setSections(mapByTitle(data.sections, maintTitle(docType), (n: any) => {
            const tables = (n.tables || []).map((tb: any[], i: number) => {
                if (i !== ti || !Array.isArray(tb[r])) return tb;
                return tb.map((row: any[], ri: number) => (ri === r ? row.map((cell: any, ci: number) => (ci === c ? v : cell)) : row));
            });
            return { ...n, tables };
        }));
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        Api.update_model_doc({ id, content: { sections: stripKeys(data.sections) }, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
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

    const editText = (value: string, onChange: (v: string) => void, extra: CSSProperties = {}) => (
        readonly
            ? <div style={{ whiteSpace: "pre-wrap", ...extra }}>{value || ""}</div>
            : <Input.TextArea variant="borderless" autoSize={{ minRows: 1, maxRows: 6 }} style={{ padding: 0, fontSize: 12, ...extra }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    );

    const assetLabel = docType === "md_020" ? "测试环境维护记录 · 资产" : "开发环境维护记录 · 资产";

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    {title}
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
                    <Button onClick={() => navigate(`/model_docs/${docType}`)}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px" }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 12px" }}>{title}</div>
                        <div style={{ color: "#888", marginBottom: 4 }}>{data.doc.file_no || ""}</div>

                        <div style={{ color: "#888", margin: "16px 0 4px" }}>{assetLabel}</div>
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

                        <div style={{ color: "#888", margin: "16px 0 4px" }}>说明（默认内容，不可编辑）</div>
                        <div style={{ border: "1px solid #eee", background: "#fafafa", borderRadius: 4, padding: "10px 12px", lineHeight: 1.7, color: "#333", fontSize: 13 }}>
                            {desc.split("\n").map((ln: string, i: number) => {
                                const t = ln.trim();
                                const isHead = t === "开发/测试环境定期验证" || /^[一二三四五六七八九十]：/.test(t);
                                return <div key={i} style={{ whiteSpace: "pre-wrap", fontWeight: isHead ? 700 : 400, marginTop: isHead ? 8 : 0 }}>{ln || "\u00a0"}</div>;
                            })}
                        </div>

                        {checks.map((tb, ti) => {
                            const kind = (String(tb[0][1] || "dev") === "server" ? "server" : "dev") as "server" | "dev";
                            const groups = envCheckGroups(docType, kind);
                            const cols = envCheckLeafCols(docType, kind);
                            const code = String(tb[0][2] || "");
                            const checkTitle = envCheckTitle(docType, kind, code);
                            const dataRows = tb.slice(1);
                            return (
                                <div key={ti} style={{ marginTop: 16, overflowX: "auto" }}>
                                    <table style={{ ...tableStyle, minWidth: 1100, tableLayout: "auto" }}>
                                        <tbody>
                                            <tr><td colSpan={cols.length} style={barCell}>{checkTitle}</td></tr>
                                            <tr>
                                                {groups.map((g, gi) => {
                                                    const extra: CSSProperties = g.label === "检查人" ? { minWidth: 120 }
                                                        : g.label.startsWith("出现的问题") ? { width: 130, minWidth: 100, maxWidth: 140 } : {};
                                                    return g.leaves.length
                                                        ? <td key={gi} colSpan={g.leaves.length} style={thCell}>{g.label}</td>
                                                        : <td key={gi} rowSpan={2} style={{ ...thCell, ...extra }}>{g.label}</td>;
                                                })}
                                            </tr>
                                            <tr>
                                                {groups.flatMap((g, gi) => g.leaves.map((lf, li) => <td key={`${gi}-${li}`} style={thCell}>{lf}</td>))}
                                            </tr>
                                            {dataRows.length === 0 ? (
                                                <tr><td colSpan={cols.length} style={{ ...tdValue, textAlign: "center", color: "#bbb" }}>该产品未查询到「开发~测试」时间线，暂无周记录</td></tr>
                                            ) : dataRows.map((row: any[], ri: number) => {
                                                let checkIdx = -1;
                                                return (
                                                    <tr key={ri}>
                                                        {cols.map((col, idx) => {
                                                            if (col.type === "date") {
                                                                return <td key={idx} style={seqCell}>{String(row[0] || "").replace("- ", "-\n")}</td>;
                                                            }
                                                            if (col.type === "problem") {
                                                                const ci = checkIdx + 2;
                                                                return (
                                                                    <td key={idx} style={{ ...tdValue, width: 130, minWidth: 100, maxWidth: 140, textAlign: "center" }}>
                                                                        {editText(String(row[ci] ?? ""), (v) => setEnvCell(ti, ri + 1, ci, v), { textAlign: "center" })}
                                                                    </td>
                                                                );
                                                            }
                                                            if (col.type === "checker") {
                                                                const ci = checkIdx + 3;
                                                                const ck = String(row[ci] ?? "");
                                                                return (
                                                                    <td key={idx} style={{ ...tdValue, textAlign: "center", minWidth: 130 }}>
                                                                        {ck.startsWith("data:image")
                                                                            ? <img src={ck} alt="检查人" style={{ height: 42, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
                                                                            : editText(ck, (v) => setEnvCell(ti, ri + 1, ci, v))}
                                                                    </td>
                                                                );
                                                            }
                                                            checkIdx += 1;
                                                            const cj = checkIdx + 1;
                                                            const mk = String(row[cj] ?? "");
                                                            return (
                                                                <td key={idx} style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap" }}>
                                                                    <div style={{ lineHeight: "22px" }}>
                                                                        <Checkbox checked={mk === "是"} disabled={readonly} onChange={() => setEnvCell(ti, ri + 1, cj, mk === "是" ? "" : "是")} style={{ transform: "scale(0.8)" }} />
                                                                        <span style={{ marginLeft: "2em", fontSize: 13 }}>是</span>
                                                                    </div>
                                                                    <div style={{ lineHeight: "22px" }}>
                                                                        <Checkbox checked={mk === "否"} disabled={readonly} onChange={() => setEnvCell(ti, ri + 1, cj, mk === "否" ? "" : "否")} style={{ transform: "scale(0.8)" }} />
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
