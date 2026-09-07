import { Button, Input, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiDataDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiPersonSign from "@/api/ApiPersonSign";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { getDataDocMeta, DATA_STATS_IMPORT_TYPES } from "./DataDocTypes";
import { computeGridSpans, isReviewRecordGrid } from "./gridSpans";
import "../pdp/PdpDocDetail.less";

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;
const COVER_MODEL_WRITER = new Set(["dd_001", "md_002_01", "md_002_02", "md_003", "dd_006", "dd_007"]);

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
    return `${num(best.year)}年${num(best.month)}月${num(best.day)}日`;
};

const toDottedDate = (s: string): string => {
    const m = String(s || "").match(/(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
    if (m) return `${m[1]}.${Number(m[2])}.${Number(m[3])}`;
    return String(s || "").trim();
};

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

const findNode = (nodes: any[], key: string): any => {
    for (const n of nodes || []) {
        if (n._key === key) return n;
        const hit = findNode(n.children || [], key);
        if (hit) return hit;
    }
    return null;
};

const mapNode = (nodes: any[], key: string, fn: (n: any) => any): any[] =>
    (nodes || []).map((n: any) =>
        n._key === key ? fn(n) : { ...n, children: mapNode(n.children || [], key, fn) }
    );

const removeNode = (nodes: any[], key: string): any[] =>
    (nodes || []).filter((n: any) => n._key !== key).map((n: any) => ({ ...n, children: removeNode(n.children || [], key) }));

const firstKey = (nodes: any[]): string => (nodes && nodes[0] ? nodes[0]._key : "");

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

const dropProductInfo = (nodes: any[]): any[] =>
    (nodes || []).filter((n: any) => n.ref_type !== "basic_info" && stripNum(n.title) !== "产品信息")
        .map((n: any) => ({ ...n, children: dropProductInfo(n.children || []) }));

const isCoverTable = (tb: any[]) => {
    if (!Array.isArray(tb) || tb.length < 4) return false;
    const labels = new Set((tb || []).filter(Array.isArray).map((r: any[]) => String(r[0] || "").trim()));
    return labels.has("编制人") && labels.has("审核人") && labels.has("批准人")
        && (labels.has("编制部门") || labels.has("生效日期"));
};

const isCoverNode = (n: any) => n?.ref_type === "cover" || (n?.tables || []).some((tb: any[]) => isCoverTable(tb));

const BASE_PROD_NAME = "肺栓塞CT图像辅助评估软件";
const BASE_PROD_TYPE = "IR-CT-PE";

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

const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "revision") {
            map[n._key] = "";
            walkChildren(n.children || [], "", map);
            return;
        }
        bodyIdx += 1;
        map[n._key] = String(bodyIdx);
        walkChildren(n.children || [], String(bodyIdx), map);
    });
    return map;
};
const walkChildren = (nodes: any[], prefix: string, map: Record<string, string>) => {
    let idx = 0;
    (nodes || []).forEach((n: any) => {
        idx += 1;
        const num = prefix ? `${prefix}.${idx}` : `${idx}`;
        map[n._key] = num;
        walkChildren(n.children || [], num, map);
    });
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
        activeKey: "",
        products: [] as any[],
    });

    const fillBasicInfo = (nodes: any[], info: Record<string, string>, replaceProduct = false): any[] => {
        const labelMap: Record<string, string> = {
            "产品名称": info.name || "",
            "软件版本": info.version || "",
            "完整版本": info.version || "",
            "产品标识": info.code || "",
            "产品代码": info.code || "",
            "适用范围": info.scope || "",
            "预期用途": info.scope || "",
            "项目名称": info.name || "",
        };
        const fix = (n: any): any => {
            const isInfo = n.ref_type === "basic_info" || stripNum(n.title) === "产品信息";
            let tables = n.tables;
            if (isInfo && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) =>
                    Array.isArray(tb)
                        ? tb.map((row: any[]) => {
                              if (!Array.isArray(row) || row.length < 2) return row;
                              const k = String(row[0]).trim();
                              if (!(k in labelMap)) return row;
                              if (!replaceProduct && String(row[1] || "").trim()) return row;
                              const next = [...row];
                              next[1] = labelMap[k];
                              return next;
                          })
                        : tb
                );
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const fillRevision = (nodes: any[], info: { fileDate?: string; version?: string; reviser?: string; approver?: string }, replace = false): any[] => {
        const fix = (n: any): any => {
            const isRev = n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
            let tables = n.tables;
            if (isRev && Array.isArray(n.tables) && Array.isArray(n.tables[0])) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const cols = (t[0] || []).length || 5;
                while (t.length < 6) t.push(new Array(cols).fill(""));
                const row = t[1];
                const setIf = (i: number, val: any) => { if (val && !String(row[i] || "").trim()) row[i] = val; };
                const setTo = (i: number, val: any) => { row[i] = val || ""; };
                if (replace) {
                    setTo(0, info.fileDate);
                    setTo(3, info.reviser);
                    setTo(4, info.approver);
                    if (!String(row[2] || "").trim()) row[2] = "首次发布";
                } else {
                    setIf(0, info.fileDate);
                    setIf(1, info.version);
                    if (!String(row[2] || "").trim()) row[2] = "首次发布";
                    setIf(3, info.reviser);
                    setIf(4, info.approver);
                }
                tables = [t, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const isShenVal = (v: any, shenSign: string) => {
        const t = String(v ?? "").trim();
        return t === "沈宏" || (!!shenSign && t === shenSign);
    };

    const relocateMisplacedCoverShen = (nodes: any[], shenSign: string, keepShenApprover: boolean): any[] => {
        const fix = (n: any): any => {
            let tables = n.tables;
            if (isCoverNode(n) && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) => {
                    if (!Array.isArray(tb) || !isCoverTable(tb)) return tb;
                    const cell = (lab: string) => {
                        const row = tb.find((r: any) => Array.isArray(r) && String(r[0] || "").trim() === lab);
                        return row ? row[1] : "";
                    };
                    const reviewFilled = !!String(cell("审核人") || "").trim();
                    const writerShen = isShenVal(cell("编制人"), shenSign);
                    const reviewShen = !keepShenApprover && isShenVal(cell("审核人"), shenSign);
                    const approverShen = !keepShenApprover && isShenVal(cell("批准人"), shenSign);
                    if (!writerShen && !reviewShen && !approverShen) return tb;
                    const moved = writerShen ? cell("编制人") : cell("批准人");
                    return tb.map((row: any[]) => {
                        if (!Array.isArray(row)) return row;
                        const next = [...row];
                        const lab = String(next[0] || "").trim();
                        if (lab === "编制人" && writerShen) next[1] = "";
                        if (lab === "批准人" && approverShen) next[1] = "";
                        if (lab === "审核人" && reviewShen) next[1] = "";
                        if (lab === "审核人" && keepShenApprover && !reviewFilled && writerShen) next[1] = moved;
                        return next;
                    });
                });
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const fillCover = (
        nodes: any[],
        info: { date?: string; 编制人?: string; 审核人?: string; 批准人?: string },
        replace = false,
    ): any[] => {
        const signers: Record<string, string> = {
            "编制人": info.编制人 || "",
            "审核人": info.审核人 || "",
            "批准人": info.批准人 || "",
        };
        const put = (row: any[], idx: number, val: string) => {
            if (replace) row[idx] = val || "";
            else if (val && !String(row[idx] || "").trim()) row[idx] = val;
        };
        const fix = (n: any): any => {
            const isCover = isCoverNode(n);
            let tables = n.tables;
            if (isCover && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) => {
                    if (!Array.isArray(tb)) return tb;
                    return tb.map((row: any[]) => {
                        if (!Array.isArray(row) || !row.length) return row;
                        const next = [...row];
                        const label = String(next[0] || "").trim();
                        if (label in signers) {
                            if (next.length >= 2) put(next, 1, signers[label]);
                            if (next.length >= 4) put(next, 3, info.date || "");
                        } else if (label === "生效日期" && next.length >= 2) {
                            put(next, 1, info.date || "");
                        }
                        return next;
                    });
                });
            }
            return { ...n, ref_type: isCover ? "cover" : n.ref_type, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const autofill = (productId: number, secs: any[], version: string, replaceProduct = false, oldProductId = 0): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            const oldId = replaceProduct && oldProductId && oldProductId !== productId ? oldProductId : 0;
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                oldId ? ApiProduct.get_product({ id: oldId }).catch(() => null) : Promise.resolve(null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiPersonSign.list_person_sign({ page_index: 0, page_size: 1000 }).catch(() => null),
            ]).then(([pr, oldPr, tl, mb, ps]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const oldProd = oldPr && oldPr.code === Api.C_OK ? (oldPr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const signRows = ps && ps.code === Api.C_OK ? ((ps.data && ps.data.rows) || []) : [];
                const signMap: Record<string, string> = {};
                signRows.forEach((s: any) => { if (s.name && s.sign_img) signMap[String(s.name).trim()] = s.sign_img; });
                const findRole = (...kws: string[]) => {
                    for (const k of kws) {
                        const hit = members.find((m: any) => String(m.role || "").includes(k));
                        if (hit) return String(hit.name || "").trim();
                    }
                    return "";
                };
                const signOr = (name: string) => (name && signMap[name]) || name || "";
                const writer = COVER_MODEL_WRITER.has(type || "")
                    ? findRole("模型负责人", "模型部负责人", "模型")
                    : findRole("数据部负责人", "数据负责人", "数据");
                const reviewer = findRole("模型");
                const approver = findRole("研发负责人");
                const fileDate = computeFileDate(tlRows, meta.keywords.concat(meta.title));
                let out = fillBasicInfo(secs, {
                    name: prod.name,
                    version: prod.full_version,
                    code: prod.product_code,
                    scope: prod.scope,
                }, replaceProduct);
                out = relocateMisplacedCoverShen(out, signMap["沈宏"] || "", false);
                out = fillCover(out, {
                    date: toDottedDate(fileDate),
                    编制人: signOr(writer),
                    审核人: signOr(reviewer),
                    批准人: signOr(approver),
                }, replaceProduct);
                out = fillRevision(out, {
                    fileDate,
                    version,
                    reviser: writer,
                    approver,
                }, replaceProduct);
                const newName = String(prod.name || "").trim();
                const newType = String(prod.type_code || "").trim();
                const newCode = String(prod.product_code || "").trim();
                const oldName = String(oldProd.name || "").trim();
                const oldType = String(oldProd.type_code || "").trim();
                const oldCode = String(oldProd.product_code || "").trim();
                out = replaceKeywords(out, [
                    [oldName, newName],
                    [BASE_PROD_NAME, newName],
                    [oldType, newType],
                    [BASE_PROD_TYPE, newType],
                    [oldCode, newCode],
                ]);
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
            autofill(doc.product_id, sections, doc.version).then((secs) => {
                dispatch({ loading: false, doc, sections: secs, activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        const prevId = data.doc.product_id;
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, data.doc.version, true, prevId).then((secs) => dispatch({ loading: false, sections: secs }));
    };

    useEffect(() => {
        load();
    }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const setSections = (sections: any[]) => dispatch({ sections });
    const patchNode = (key: string, patch: any) =>
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, ...patch })));

    const addChild = (key: string) => {
        const child = { _key: genKey(), title: "新章节", body: "", tables: [], children: [] };
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, children: [...(n.children || []), child] })));
        dispatch({ activeKey: child._key });
    };
    const addRoot = () => {
        const node = { _key: genKey(), title: "新章节", body: "", tables: [], children: [] };
        const sections = [...data.sections, node];
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
    };

    const active = findNode(data.sections, data.activeKey);
    const updateTables = (tables: any[]) => patchNode(data.activeKey, { tables });
    const setCell = (ti: number, r: number, ci: number, val: string, colSpan = 1, rowSpan = 1) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cs = Math.max(1, colSpan);
            const rs = Math.max(1, rowSpan);
            return tb.map((row: any[], ri: number) => {
                if (ri < r || ri >= r + rs) return row;
                const next = [...row];
                while (next.length < ci + cs) next.push("");
                return next.map((cell: any, cc: number) => (cc < ci || cc >= ci + cs ? cell : val));
            });
        });
        updateTables(tables);
    };
    const addRow = (ti: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cols = tb[0] ? tb[0].length : 1;
            return [...tb, new Array(cols).fill("")];
        });
        updateTables(tables);
    };
    const delRow = (ti: number, r: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.filter((_: any, ri: number) => ri !== r)));
        updateTables(tables);
    };
    const addCol = (ti: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.map((row: any[]) => [...row, ""])));
        updateTables(tables);
    };
    const delCol = (ti: number, ci: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => (i !== ti ? tb : tb.map((row: any[]) => row.filter((_: any, cc: number) => cc !== ci))));
        updateTables(tables);
    };
    const addTable = () => updateTables([...(active.tables || []), [["", ""], ["", ""]]]);
    const delTable = (ti: number) => updateTables((active.tables || []).filter((_: any, i: number) => i !== ti));

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_data_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
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

    const isMetaSection = (n: any) => {
        const t = stripNum(n.title);
        return n.ref_type === "cover" || n.ref_type === "revision" || t === "文件修订记录";
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
            dispatch({ sections: [...kept, ...incoming], activeKey: incoming[0]._key });
            message.success("已填入统计表，请保存");
        }).catch(() => {
            dispatch({ loading: false });
            message.error("导入失败");
        });
        return false;
    };

    const numbers = computeNumbers(data.sections);
    const backPath = `/data_docs/${type || data.doc.doc_type || "dd_001"}`;

    const renderNav = (nodes: any[], depth: number) =>
        (nodes || []).map((n: any) => {
            const num = numbers[n._key];
            const label = `${num ? num + " " : ""}${stripNum(n.title) || "(未命名)"}`;
            return (
            <div key={n._key}>
                <div
                    className={`pdp-nav-item${n._key === data.activeKey ? " active" : ""}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => dispatch({ activeKey: n._key })}>
                    <span className="pdp-nav-title" title={label}>{label}</span>
                    {!readonly && (
                        <span className="pdp-nav-ops" onClick={(e) => e.stopPropagation()}>
                            <PlusOutlined title="添加子章节" onClick={() => addChild(n._key)} />
                            <DeleteOutlined title="删除章节" onClick={() => delNode(n._key)} />
                        </span>
                    )}
                </div>
                {renderNav(n.children || [], depth + 1)}
            </div>
            );
        });

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
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    )}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    {!readonly && DATA_STATS_IMPORT_TYPES.has(type || "") && (
                        <Upload
                            accept=".xlsx,.xls"
                            showUploadList={false}
                            beforeUpload={(file) => doImportStats(file as File)}>
                            <Button icon={<UploadOutlined />}>导入统计 Excel</Button>
                        </Upload>
                    )}
                    <Button onClick={() => navigate(backPath)}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；编号按层级自动生成</div>
                        )}
                        {renderNav(data.sections, 0)}
                        {!readonly && (
                            <Button className="pdp-nav-add" type="dashed" size="small" icon={<PlusOutlined />} onClick={addRoot}>
                                顶级章节
                            </Button>
                        )}
                    </div>
                    <div className="pdp-editor">
                        {!active ? (
                            <div className="pdp-empty">请选择或新增左侧章节</div>
                        ) : (
                            <>
                                <div className="pdp-field">
                                    <div className="pdp-label">章节标题{numbers[active._key] ? `（编号 ${numbers[active._key]} 自动生成）` : ""}</div>
                                    <Input
                                        addonBefore={numbers[active._key] || undefined}
                                        value={stripNum(active.title)}
                                        disabled={readonly}
                                        placeholder="只填名称，如：目的"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })}
                                    />
                                </div>
                                <div className="pdp-field">
                                    <div className="pdp-label">正文</div>
                                    <Input.TextArea
                                        autoSize={{ minRows: 3, maxRows: 20 }}
                                        value={active.body ?? ""}
                                        disabled={readonly}
                                        placeholder="本章节正文内容，可多行"
                                        onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                    />
                                </div>

                                {(active.tables || []).map((tb: any[], ti: number) => (
                                    <div className="pdp-table-block" key={ti}>
                                        <div className="pdp-table-bar">
                                            <span className="pdp-label">表格 {ti + 1}</span>
                                            {!readonly && (
                                                <Space size={4}>
                                                    <Button size="small" onClick={() => addRow(ti)}>＋行</Button>
                                                    <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                    <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                </Space>
                                            )}
                                        </div>
                                        <table className="pdp-grid">
                                            <tbody>
                                                {(() => {
                                                    const review = isReviewRecordGrid(tb);
                                                    const spans = review ? computeGridSpans(tb) : null;
                                                    const cols = tb.reduce((m: number, row: any[]) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
                                                    return tb.map((row: any[], r: number) => (
                                                    <tr key={r}>
                                                        {(review ? Array.from({ length: cols }, (_, ci) => ci) : row.map((_: any, ci: number) => ci)).map((ci: number) => {
                                                            const sp = spans?.[r]?.[ci];
                                                            if (sp?.skip) return null;
                                                            const cell = row[ci] ?? "";
                                                            const cs = sp?.colSpan || 1;
                                                            const rs = sp?.rowSpan || 1;
                                                            return (
                                                            <td
                                                                key={ci}
                                                                className={r === 0 ? "head" : ""}
                                                                colSpan={cs > 1 ? cs : undefined}
                                                                rowSpan={rs > 1 ? rs : undefined}
                                                                style={cs > 1 || rs > 1 ? { verticalAlign: "middle" } : undefined}
                                                            >
                                                                {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                    <span style={{ position: "relative", display: "inline-block" }}>
                                                                        <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                        {!readonly && (
                                                                            <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "", cs, rs)} />
                                                                        )}
                                                                    </span>
                                                                ) : (
                                                                    <Input.TextArea
                                                                        className="pdp-cell"
                                                                        autoSize={{ minRows: 1, maxRows: 8 }}
                                                                        value={cell ?? ""}
                                                                        disabled={readonly}
                                                                        onChange={(e) => setCell(ti, r, ci, e.target.value, cs, rs)}
                                                                    />
                                                                )}
                                                                {!readonly && r === 0 && tb[0].length > 1 && (
                                                                    <DeleteOutlined className="pdp-col-del" title="删除该列" onClick={() => delCol(ti, ci)} />
                                                                )}
                                                            </td>
                                                            );
                                                        })}
                                                        {!readonly && (
                                                            <td className="pdp-row-op">
                                                                {tb.length > 1 && (
                                                                    <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                    ));
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}

                                {!readonly && (
                                    <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>
                                        添加表格
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
