import { Button, Checkbox, Input, Space, Spin, Upload, message } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiDataDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { getDataDocMeta, DATA_STATS_IMPORT_TYPES } from "./DataDocTypes";
import { computeGridSpans } from "./gridSpans";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "fixed" };
const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "6px 10px", fontSize: 13, verticalAlign: "middle", textAlign: "center" };
const tdHead: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600 };
const tdValue: CSSProperties = { ...tdBase, color: "#333", whiteSpace: "pre-wrap" };
const tdOp: CSSProperties = { ...tdBase, width: 100, padding: "4px 6px", whiteSpace: "nowrap" };

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n,
        _key: n._key || genKey(),
        body: n.body ?? "",
        tables: Array.isArray(n.tables) ? n.tables : [],
        children: ensureKeys(n.children || []),
    }));

const stripKeys = (nodes: any[]): any[] =>
    (nodes || []).map(({ _key, ...rest }: any) => ({ ...rest, children: stripKeys(rest.children || []) }));

const mapNode = (nodes: any[], key: string, fn: (n: any) => any): any[] =>
    (nodes || []).map((n: any) =>
        n._key === key ? fn(n) : { ...n, children: mapNode(n.children || [], key, fn) }
    );

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

const isMetaSection = (n: any) => {
    const t = stripNum(n?.title);
    return n?.ref_type === "cover" || n?.ref_type === "revision" || n?.ref_type === "basic_info"
        || t === "文件修订记录" || t === "产品信息";
};

const dropProductInfo = (nodes: any[]): any[] =>
    (nodes || []).filter((n: any) => n.ref_type !== "basic_info" && stripNum(n.title) !== "产品信息")
        .map((n: any) => ({ ...n, children: dropProductInfo(n.children || []) }));

const hideSheetTitle = (title: string) => {
    const t = stripNum(title);
    return !t || /^Sheet\d*$/i.test(t) || /^工作表\d*$/.test(t);
};

const maxTableCols = (nodes: any[]): number =>
    (nodes || []).reduce((m, n) => {
        const t = (n.tables || []).reduce((tm: number, tb: any[]) =>
            Math.max(tm, (tb || []).reduce((rm: number, row: any[]) => Math.max(rm, Array.isArray(row) ? row.length : 0), 0)), 0);
        return Math.max(m, t, maxTableCols(n.children || []));
    }, 0);

const looksLikeFileNo = (s: string) => /TX-|DD-|MD-/.test(String(s || ""));

const onlyFirstRow = (row: any[], cols: number) => {
    if (!String(row?.[0] ?? "").trim()) return false;
    for (let c = 1; c < cols; c++) if (String(row[c] ?? "").trim()) return false;
    return true;
};

const rowAllEmpty = (row: any[], cols: number) => {
    for (let c = 0; c < cols; c++) if (String(row?.[c] ?? "").trim()) return false;
    return true;
};

const isSignLabel = (s: string) => /^(评估人|复核人|记录人)/.test(String(s || "").trim());
const isSignRow = (row: any[]) => (row || []).some((c: any) => isSignLabel(String(c ?? "")));
const isMetaLabelRow = (row: any[]) => /^(结论|问题描述)/.test(String(row?.[0] ?? "").trim());
const stripPua = (s: any) => {
    if (typeof s !== "string" || s.startsWith("data:image")) return s;
    return s
        .replace(/[\uF000-\uF8FF]/g, "")
        .replace(/þ/g, "☑")
        .replace(/¨/g, "☐")
        .replace(/(^|[\s])o(?=正常|不正常|不适用|是|否|无重复|有重复)/g, "$1☐")
        .replace(/[ \t]+$/g, "");
};

const CHECK_OPT = "正常|不正常|不适用|是|否|无重复|有重复";
const parseCheckItem = (s: string) => {
    const t = String(s || "").trim();
    const m = t.match(new RegExp(`^([☑☐])(${CHECK_OPT})$`));
    return m ? { checked: m[1] === "☑", label: m[2] } : null;
};
const parseCheckItems = (s: any) => {
    if (typeof s !== "string" || s.startsWith("data:image")) return null;
    const lines = stripPua(s).split(/\n/).map((x: string) => x.trim()).filter(Boolean);
    if (!lines.length) return null;
    const items = lines.map(parseCheckItem);
    if (items.some((it: { checked: boolean; label: string } | null) => !it)) return null;
    return items as Array<{ checked: boolean; label: string }>;
};
const joinCheckItems = (items: Array<{ checked: boolean; label: string }>) =>
    items.map((it) => `${it.checked ? "☑" : "☐"}${it.label}`).join("\n");

const computeRecordSpans = (grid: any[][]) => {
    const spans = computeGridSpans(grid);
    const rows = grid || [];
    const R = rows.length;
    const C = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const at = (r: number, c: number) => String(rows[r]?.[c] ?? "");
    for (let r = 0; r < R; r++) {
        if (rowAllEmpty(rows[r], C) || isSignRow(rows[r])) continue;
        for (let c = 0; c < C; c++) {
            if (spans[r][c].skip) continue;
            let c2 = c + spans[r][c].colSpan - 1;
            while (c2 + 1 < C && !spans[r][c2 + 1].skip && !at(r, c2 + 1).trim()) {
                spans[r][c2 + 1].skip = true;
                spans[r][c].colSpan += 1;
                c2 += 1;
            }
        }
    }
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (spans[r][c].skip || !at(r, c).trim()) continue;
            const cs = spans[r][c].colSpan;
            let r2 = r;
            while (r2 + 1 < R) {
                if (rowAllEmpty(rows[r2 + 1], C) || isSignRow(rows[r2 + 1])) break;
                let ok = true;
                for (let k = 0; k < cs; k++) {
                    const cell = spans[r2 + 1]?.[c + k];
                    if (!cell || cell.skip || at(r2 + 1, c + k).trim()) { ok = false; break; }
                }
                if (!ok) break;
                r2 += 1;
            }
            if (r2 > r) {
                spans[r][c].rowSpan = r2 - r + 1;
                for (let k = r + 1; k <= r2; k++) {
                    for (let j = 0; j < cs; j++) spans[k][c + j].skip = true;
                }
            }
        }
    }
    return spans;
};

const BASE_PROD_NAME = "肺栓塞CT图像辅助评估软件";
const BASE_PROD_TYPE = "IR-CT-PE";
const PROD_LABEL_NAME = new Set(["产品名称", "项目名称", "所属项目", "数据所属项目"]);
const PROD_LABEL_VER = new Set(["软件版本", "完整版本"]);
const PROD_LABEL_CODE = new Set(["产品标识", "产品代码"]);
const PROD_LABEL_SCOPE = new Set(["预期用途", "适用范围"]);
const PROD_COL_HEADERS = new Set(["产品名称", "完整版本", "软件版本", "所属项目", "数据所属项目"]);

const productValueForLabel = (label: string, info: { name: string; version: string; code: string; scope: string }) => {
    if (PROD_LABEL_NAME.has(label)) return info.name;
    if (PROD_LABEL_VER.has(label)) return info.version;
    if (PROD_LABEL_CODE.has(label)) return info.code;
    if (PROD_LABEL_SCOPE.has(label)) return info.scope;
    return "";
};

const isProdLabelValueRow = (row: any[], cols: number) => {
    if (!productValueForLabel(String(row?.[0] ?? "").trim(), { name: "x", version: "x", code: "x", scope: "x" })) return false;
    for (let c = 2; c < cols; c++) if (String(row?.[c] ?? "").trim()) return false;
    return true;
};

const fillRecordProductCells = (nodes: any[], info: { name: string; version: string; code: string; scope: string }, replace: boolean): any[] => {
    const put = (cur: any, next: string) => {
        if (!next) return cur;
        if (replace || !String(cur ?? "").trim()) return next;
        return cur;
    };
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        let headerIdx = -1;
        const colLabel: string[] = [];
        for (let r = 0; r < tb.length; r++) {
            const row = tb[r];
            if (!Array.isArray(row) || isProdLabelValueRow(row, cols)) continue;
            const hits = row.filter((c) => PROD_COL_HEADERS.has(String(c ?? "").trim())).length;
            const filled = row.filter((c) => String(c ?? "").trim()).length;
            if (hits >= 1 && filled >= 2) {
                headerIdx = r;
                for (let c = 0; c < cols; c++) colLabel[c] = String(row[c] ?? "").trim();
                break;
            }
        }
        return tb.map((row: any[], ri: number) => {
            if (!Array.isArray(row)) return row;
            const next = [...row];
            if (isProdLabelValueRow(next, cols)) {
                const mapped = productValueForLabel(String(next[0] ?? "").trim(), info);
                while (next.length < 2) next.push("");
                next[1] = put(next[1], mapped);
            }
            if (headerIdx >= 0 && ri > headerIdx) {
                for (let c = 0; c < cols; c++) {
                    const mapped = productValueForLabel(colLabel[c] || "", info);
                    if (!mapped) continue;
                    while (next.length <= c) next.push("");
                    next[c] = put(next[c], mapped);
                }
            }
            return next;
        });
    };
    const fix = (n: any): any => ({
        ...n,
        tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
        children: (n.children || []).map(fix),
    });
    return (nodes || []).map(fix);
};

const replaceExact = (s: any, from: string, to: string) => {
    if (!from || !to || from === to) return s;
    if (typeof s !== "string" || s.startsWith("data:image")) return s;
    return s.includes(from) ? s.split(from).join(to) : s;
};

const replaceKeywords = (nodes: any[], pairs: Array<[string, string]>): any[] => {
    const list = (pairs || [])
        .filter(([from, to]) => from && to && from !== to)
        .sort((a, b) => b[0].length - a[0].length);
    if (!list.length) return nodes;
    const apply = (s: any) => list.reduce((acc, [from, to]) => replaceExact(acc, from, to), s);
    const fix = (n: any): any => ({
        ...n,
        title: apply(n.title),
        body: apply(n.body),
        tables: (n.tables || []).map((tb: any[]) =>
            Array.isArray(tb)
                ? tb.map((row: any[]) => (Array.isArray(row) ? row.map((c: any) => apply(c)) : row))
                : tb
        ),
        children: (n.children || []).map(fix),
    });
    return (nodes || []).map(fix);
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id, type } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");
    const meta = getDataDocMeta(type);

    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        sections: [] as any[],
        products: [] as any[],
    });

    const autofill = (productId: number, secs: any[], replaceProduct = false, oldProductId = 0): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            const oldId = replaceProduct && oldProductId && oldProductId !== productId ? oldProductId : 0;
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                oldId ? ApiProduct.get_product({ id: oldId }).catch(() => null) : Promise.resolve(null),
            ]).then(([pr, oldPr]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const oldProd = oldPr && oldPr.code === Api.C_OK ? (oldPr.data || {}) : {};
                const info = {
                    name: String(prod.name || "").trim(),
                    version: String(prod.full_version || "").trim(),
                    code: String(prod.product_code || "").trim(),
                    scope: String(prod.scope || "").trim(),
                };
                let out = replaceKeywords(secs, [
                    [String(oldProd.name || "").trim(), info.name],
                    [BASE_PROD_NAME, info.name],
                    [String(oldProd.type_code || "").trim(), String(prod.type_code || "").trim()],
                    [BASE_PROD_TYPE, String(prod.type_code || "").trim()],
                    [String(oldProd.product_code || "").trim(), info.code],
                    [String(oldProd.full_version || "").trim(), info.version],
                ]);
                out = fillRecordProductCells(out, info, replaceProduct);
                resolve(out);
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_data_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = dropProductInfo(ensureKeys((doc.content && doc.content.sections) || []));
            autofill(doc.product_id, sections).then((secs) => {
                const fileNo = String(doc.file_no || "").trim();
                const withNo = fileNo ? (secs || []).map(function fix(n: any): any {
                    return {
                        ...n,
                        tables: (n.tables || []).map((tb: any[]) => {
                            if (!Array.isArray(tb)) return tb;
                            const cols = tb.reduce((m: number, row: any[]) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
                            return tb.map((row: any[]) => {
                                if (!onlyFirstRow(row, cols) || !looksLikeFileNo(String(row[0] ?? ""))) return row;
                                const next = [...row];
                                next[0] = fileNo;
                                return next;
                            });
                        }),
                        children: (n.children || []).map(fix),
                    };
                }) : secs;
                dispatch({ loading: false, doc, sections: withNo });
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        const prevId = data.doc.product_id;
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, true, prevId).then((secs) => dispatch({ loading: false, sections: secs }));
    };

    useEffect(() => { load(); }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const setSections = (sections: any[]) => dispatch({ sections });
    const patchNode = (key: string, patch: any) =>
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, ...patch })));

    const setCell = (key: string, ti: number, r: number, ci: number, val: string, colSpan = 1, rowSpan = 1) => {
        patchNode(key, {
            tables: ((data.sections && findTables(data.sections, key)) || []).map((tb: any[], i: number) => {
                if (i !== ti) return tb;
                const cs = Math.max(1, colSpan);
                const rs = Math.max(1, rowSpan);
                return tb.map((row: any[], ri: number) => {
                    if (ri < r || ri >= r + rs) return row;
                    const next = [...row];
                    while (next.length < ci + cs) next.push("");
                    return next.map((cell: any, cc: number) => (cc < ci || cc >= ci + cs ? cell : val));
                });
            }),
        });
    };

    const findTables = (nodes: any[], key: string): any[] | undefined => {
        for (const n of nodes || []) {
            if (n._key === key) return n.tables || [];
            const hit = findTables(n.children || [], key);
            if (hit !== undefined) return hit;
        }
        return undefined;
    };

    const addRow = (key: string, ti: number, afterR: number) => {
        const tables = (findTables(data.sections, key) || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cols = tb[0] ? tb[0].length : 1;
            const src = tb[afterR] || [];
            const blank = new Array(cols).fill("");
            if (src.length && !isSignRow(src) && !isMetaLabelRow(src) && !onlyFirstRow(src, cols)) {
                blank[0] = src[0] ?? "";
            }
            const next = [...tb];
            next.splice(afterR + 1, 0, blank);
            return next;
        });
        patchNode(key, { tables });
    };
    const delRow = (key: string, ti: number, r: number) => {
        const tables = (findTables(data.sections, key) || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.filter((_: any, ri: number) => ri !== r)
        );
        patchNode(key, { tables });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        Api.update_data_doc({ id, content: { sections: stripKeys(data.sections) }, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_data_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const doImportStats = (file: File) => {
        dispatch({ loading: true });
        Api.import_stats_excel(file).then((res: any) => {
            dispatch({ loading: false });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "导入失败");
                return;
            }
            const incoming = dropProductInfo(ensureKeys(res.data?.sections || []));
            if (!incoming.length) {
                message.error("Excel 无有效表格");
                return;
            }
            const kept = (data.sections || []).filter((n: any) => isMetaSection(n));
            dispatch({ sections: [...kept, ...incoming] });
            message.success("已填入统计表，请保存");
        }).catch(() => {
            dispatch({ loading: false });
            message.error("导入失败");
        });
        return false;
    };

    const backPath = `/data_docs/${type || data.doc.doc_type || "dd_002"}`;

    const renderTable = (n: any, ti: number, tb: any[]) => {
        const spans = computeRecordSpans(tb);
        const cols = tb.reduce((m: number, row: any[]) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
        const firstBody = tb.findIndex((row: any[]) =>
            !onlyFirstRow(row, cols) && (row || []).some((c: any) => String(c ?? "").trim())
        );
        return (
            <div key={ti} style={{ marginBottom: 8, overflowX: "visible" }}>
                <table style={tableStyle}>
                    <tbody>
                        {tb.map((row: any[], r: number) => {
                            const banner = onlyFirstRow(row, cols);
                            const bannerText = String(row[0] ?? "").trim();
                            if (banner && (looksLikeFileNo(bannerText) || bannerText === meta.title || r <= 1)) return null;
                            const emptyRow = rowAllEmpty(row, cols);
                            if (emptyRow) return null;
                            const allSkip = Array.from({ length: cols }, (_, ci) => !!spans?.[r]?.[ci]?.skip).every(Boolean);
                            if (allSkip) return <tr key={r} />;
                            const subHead = firstBody >= 0 && r === firstBody + 1
                                && !String(row[0] ?? "").trim()
                                && row.slice(1).some((c: any) => String(c ?? "").trim());
                            const isHeadRow = banner || r === firstBody || subHead;
                            const sign = isSignRow(row);
                            const showOps = !readonly && !emptyRow && !isHeadRow && !sign && !isMetaLabelRow(row);
                            return (
                            <tr key={r}>
                                {Array.from({ length: cols }, (_, ci) => ci).map((ci: number) => {
                                    const sp = spans?.[r]?.[ci];
                                    if (sp?.skip) return null;
                                    const raw = row[ci] ?? "";
                                    const cell = stripPua(raw);
                                    const checkItems = parseCheckItems(cell);
                                    const cs = sp?.colSpan || 1;
                                    const rs = sp?.rowSpan || 1;
                                    const align = sign ? "left" : "center";
                                    const st: CSSProperties = isHeadRow ? tdHead : { ...tdValue, textAlign: align };
                                    return (
                                        <td
                                            key={ci}
                                            colSpan={cs > 1 ? cs : undefined}
                                            rowSpan={rs > 1 ? rs : undefined}
                                            style={st}
                                        >
                                            {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                <img src={cell} alt="" style={{ maxHeight: 36 }} />
                                            ) : checkItems ? (
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                                                    {checkItems.map((it, ii) => (
                                                        <Checkbox
                                                            key={ii}
                                                            checked={it.checked}
                                                            disabled={readonly}
                                                            style={{ transform: "scale(0.85)", fontSize: 13 }}
                                                            onChange={() => {
                                                                const next = checkItems.map((x, j) =>
                                                                    j === ii ? { ...x, checked: !x.checked } : x
                                                                );
                                                                setCell(n._key, ti, r, ci, joinCheckItems(next), cs, rs);
                                                            }}
                                                        >
                                                            {it.label}
                                                        </Checkbox>
                                                    ))}
                                                </div>
                                            ) : (
                                                <Input.TextArea
                                                    variant="borderless"
                                                    autoSize={{ minRows: 1 }}
                                                    value={cell ?? ""}
                                                    disabled={readonly}
                                                    style={{ padding: 0, textAlign: align, fontSize: 13, lineHeight: 1.4, width: "100%", minWidth: 0, overflow: "hidden" }}
                                                    onChange={(e) => setCell(n._key, ti, r, ci, e.target.value, cs, rs)}
                                                />
                                            )}
                                        </td>
                                    );
                                })}
                                {!readonly && (
                                    <td style={isHeadRow ? { ...tdHead, width: 100 } : tdOp}>
                                        {isHeadRow && r === firstBody ? "操作" : showOps ? (
                                            <span style={{ display: "inline-flex", gap: 14, justifyContent: "center" }}>
                                                <PlusOutlined title="在下方插入行" style={{ color: "#1677ff", cursor: "pointer" }} onClick={() => addRow(n._key, ti, r)} />
                                                {tb.length > 1 && (
                                                    <DeleteOutlined title="删除该行" style={{ color: "#999", cursor: "pointer" }} onClick={() => delRow(n._key, ti, r)} />
                                                )}
                                            </span>
                                        ) : null}
                                    </td>
                                )}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderSection = (n: any) => {
        if (isMetaSection(n)) return null;
        const title = stripNum(n.title);
        return (
            <div key={n._key} style={{ marginBottom: 8 }}>
                {!hideSheetTitle(title) && (
                    <div style={{ fontWeight: 600, margin: "8px 0 6px" }}>{title}</div>
                )}
                {(n.body || "").trim() ? (
                    <div style={{ whiteSpace: "pre-wrap", marginBottom: 8, color: "#333" }}>{n.body}</div>
                ) : null}
                {(n.tables || []).map((tb: any[], ti: number) => Array.isArray(tb) ? renderTable(n, ti, tb) : null)}
                {(n.children || []).map((c: any) => renderSection(c))}
            </div>
        );
    };

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
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
                    {!readonly && DATA_STATS_IMPORT_TYPES.has(type || "") && (
                        <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={(file) => doImportStats(file as File)}>
                            <Button icon={<UploadOutlined />}>导入统计 Excel</Button>
                        </Upload>
                    )}
                    <Button onClick={() => navigate(backPath)}>{ts("back")}</Button>
                </Space>
            </div>
            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 20px", maxWidth: maxTableCols(data.sections) > 8 ? 1600 : 1100 }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>{meta.title}</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>
                        {(data.sections || []).map((n: any) => renderSection(n))}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
