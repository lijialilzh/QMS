import "./DataStats.less";
import { Button, Input, Radio, Space, Spin, Table, Tabs, message } from "antd";
import { FolderOpenOutlined, DownloadOutlined, CloudServerOutlined, UploadOutlined } from "@ant-design/icons";
import { useMemo, useRef, useEffect } from "react";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiDataDoc";
import * as ApiModel from "@/api/ApiModelDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiChapter from "@/api/ApiProdAlgoChapter";
import { DATA_DOC_MENU, getDataDocGroupTypes } from "../model_doc/DataDocTypes";
import { MODEL_DOC_MENU, getModelDocGroupTypes } from "../model_doc/ModelDocTypes";
import {
    STATS_TITLES,
    StatsKind,
    DETAIL_COLUMNS,
    buildStatsGrid,
    autoStatsExtra,
    buildWorkbookSheets,
    buildTriageAoa,
    distRowsFromGrid,
    statsFromFiles,
    CaseRow,
    SheetAoa,
    readLastStats,
    readStatsCache,
    saveStatsCache,
    pidsFromRows,
    fillPidTable,
    buildAnnotMeta,
    AnnotFillMeta,
    attachCaseRows,
    caseRowsFromContent,
    importGpdExcel,
    normalizeStatsRows,
} from "./dataStatsLocal";
import { fillDd002Hospitals, fillDd003FromReturn, fillDd010FromReturn, fillDd011Feedback, fillDd012FromProduct, stripKeys } from "../model_doc/DataRecordDocDetail";

const KIND_DOC: Record<StatsKind, { type: string; title: string }> = {
    raw: { type: "dd_015_01", title: "原始数据库统计表" },
    base: { type: "dd_015_02", title: "基础数据库统计表" },
    ann: { type: "dd_015_03", title: "标注数据库统计表" },
};
const ANN_PID_DOCS = [
    { type: "dd_008_01", title: "肺栓塞分割试标注记录" },
    { type: "dd_008_02", title: "肺叶分割试标注记录" },
    { type: "dd_009_01", title: "肺栓塞分割标注记录" },
    { type: "dd_009_02", title: "肺叶分割标注记录" },
    { type: "dd_009_03", title: "肺栓塞分诊评测记录" },
];

const AUTO_DOC_VERSION = "A0";
const AUTO_CHANGE_LOG = "数据统计自动建档";

const expandMenuTypes = (menu: { types: string[] }[], groupTypes: (t: string) => string[]) => {
    const out: string[] = [];
    menu.forEach((item) => {
        item.types.forEach((t) => {
            const kids = groupTypes(t);
            (kids.length ? kids : [t]).forEach((x) => {
                if (x && !x.endsWith("_qr") && !out.includes(x)) out.push(x);
            });
        });
    });
    return out;
};
const STATS_DATA_DOC_TYPES = expandMenuTypes(DATA_DOC_MENU, getDataDocGroupTypes);
const STATS_MODEL_DOC_TYPES = expandMenuTypes(MODEL_DOC_MENU, getModelDocGroupTypes);

const isAlreadyExist = (msg: any) => /exist|已存在|msg_obj_exist/i.test(String(msg || ""));

const ensureOneDoc = async (
    kind: "data" | "model",
    productId: number,
    doc_type: string,
): Promise<{ status: "ok" | "skip" | "error"; type: string; msg?: string }> => {
    const listFn = kind === "data" ? Api.list_data_doc : ApiModel.list_model_doc;
    const addFn = kind === "data" ? Api.add_data_doc : ApiModel.add_model_doc;
    const list: any = await listFn({ product_id: productId, doc_type, page_index: 0, page_size: 1 });
    if (list.code !== Api.C_OK) return { status: "error", type: doc_type, msg: list.msg };
    if (((list.data && list.data.rows) || []).length) return { status: "skip", type: doc_type };
    const add: any = await addFn({
        product_id: productId,
        doc_type,
        version: AUTO_DOC_VERSION,
        change_log: AUTO_CHANGE_LOG,
    });
    if (add.code === Api.C_OK) return { status: "ok", type: doc_type };
    if (isAlreadyExist(add.msg)) return { status: "skip", type: doc_type };
    return { status: "error", type: doc_type, msg: add.msg || `新建「${doc_type}」失败` };
};

const ensureMissingDocs = async (productId: number) => {
    const jobs: { kind: "data" | "model"; type: string }[] = [
        ...STATS_DATA_DOC_TYPES.map((type) => ({ kind: "data" as const, type })),
        ...STATS_MODEL_DOC_TYPES.map((type) => ({ kind: "model" as const, type })),
    ];
    const results: { status: "ok" | "skip" | "error"; type: string; msg?: string }[] = [];
    const chunk = 4;
    for (let i = 0; i < jobs.length; i += chunk) {
        const part = await Promise.all(jobs.slice(i, i + chunk).map((j) => ensureOneDoc(j.kind, productId, j.type)));
        results.push(...part);
    }
    return {
        created: results.filter((r) => r.status === "ok").length,
        errors: results.filter((r) => r.status === "error").map((r) => r.msg || `新建「${r.type}」失败`),
    };
};

const stripNum = (title: string) => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();
const isMetaSection = (n: any) => {
    const t = stripNum(n?.title);
    return n?.ref_type === "cover" || n?.ref_type === "revision" || n?.ref_type === "basic_info"
        || t === "文件修订记录" || t === "产品信息";
};

type AnnPack = { modules: string[]; rows: Record<string, CaseRow[]>; sources: Record<string, string> };

/** 标注库按算法模块分开缓存；「ann」槽位仍存汇总，供数据库上传记录读取标注数据量。 */
const annSlot = (module: string) => `ann@${module}` as StatsKind;

const moduleKey = (name: string) => String(name || "").replace(/模块$/, "").trim();

/** 汇总：按模块顺序合并，同一序列只算一次。 */
const mergeAnnRows = (modules: string[], byModule: Record<string, CaseRow[]>): CaseRow[] => {
    const seen = new Set<string>();
    const out: CaseRow[] = [];
    (modules || []).forEach((m) => {
        (byModule[m] || []).forEach((r) => {
            const key = String(r.SeriesInstanceUID || "").trim() || `${r.TXID || ""}|${r.PatientID || ""}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(r);
        });
    });
    return out;
};

const joinAnnSources = (modules: string[], sources: Record<string, string>) =>
    (modules || []).filter((m) => sources[m]).map((m) => `${m}：${sources[m]}`).join("；");

const ANN_PATH_KEY = "qms_data_stats_ann_paths_v1";
const readAnnPaths = (productId: number): Record<string, string> => {
    try {
        const all = JSON.parse(localStorage.getItem(ANN_PATH_KEY) || "{}") || {};
        return all[String(productId || 0)] || {};
    } catch (_e) {
        return {};
    }
};
const saveAnnPath = (productId: number, module: string, path: string) => {
    try {
        const all = JSON.parse(localStorage.getItem(ANN_PATH_KEY) || "{}") || {};
        const key = String(productId || 0);
        all[key] = { ...(all[key] || {}), [module]: path };
        localStorage.setItem(ANN_PATH_KEY, JSON.stringify(all));
    } catch (_e) {
        // 本机存不下时只是下次不记得路径
    }
};

const commonParent = (paths: string[]) => {
    const items = (paths || []).map((p) => String(p || "").trim()).filter(Boolean);
    if (!items.length) return "";
    const hostM = items[0].match(/^([\w.-]+):(\/.*)$/);
    const host = hostM ? hostM[1] : "";
    const locals = items.map((p) => {
        const m = p.match(/^[\w.-]+:(\/.*)$/);
        return (m ? m[1] : p).replace(/[\\/]+$/, "");
    });
    if (locals.length === 1) return host ? `${host}:${locals[0]}` : locals[0];
    const parts = locals.map((p) => p.split(/[\\/]+/));
    const common: string[] = [];
    for (let i = 0; i < parts[0].length; i++) {
        const seg = parts[0][i];
        if (parts.every((p) => p[i] === seg)) common.push(seg);
        else break;
    }
    const joined = common.join("/") || "/";
    return host ? `${host}:${joined}` : joined;
};

/** 数据库上传记录标注表里，数据集名含该模块名的行的存储路径。 */
const annPathFromDd010 = (content: any, module: string) => {
    const key = moduleKey(module);
    if (!key) return "";
    const found: string[] = [];
    const walk = (ns: any[]) => (ns || []).forEach((n: any) => {
        (n?.tables || []).forEach((tb: any[]) => {
            if (!Array.isArray(tb)) return;
            let setI = -1;
            let pathI = -1;
            tb.forEach((row: any[]) => {
                if (!Array.isArray(row)) return;
                const cells = row.map((c) => String(c ?? "").trim());
                if (cells.includes("数据集") && cells.includes("存储路径")) {
                    setI = cells.indexOf("数据集");
                    pathI = cells.indexOf("存储路径");
                    return;
                }
                if (setI < 0 || pathI < 0) return;
                if (cells[setI].includes(key) && cells[pathI]) found.push(cells[pathI]);
            });
        });
        walk(n?.children || []);
    });
    walk((content && content.sections) || []);
    return commonParent(found);
};

export default () => {
    const folderRef = useRef<HTMLInputElement>(null);
    const gpdExcelRef = useRef<HTMLInputElement>(null);
    const [data, dispatch] = useData({
        kind: "raw" as StatsKind,
        rows: [] as CaseRow[],
        loading: false,
        progress: "",
        dataType: "",
        disease: "",
        person: "",
        source: "",
        productId: 0,
        products: [] as any[],
        writing: false,
        pageSize: 50,
        serverPaths: {
            raw: "10.10.1.11:/media/tx-deepocean/Data1/DATA/dr/dr全身骨折注册/肋骨骨折2/test",
            base: "",
            ann: "",
        } as Record<StatsKind, string>,
        serverUser: "tx-deepocean",
        serverPass: "tuixiang2017",
        annModules: [] as string[],
        annModule: "",
        annRows: {} as Record<string, CaseRow[]>,
        annSources: {} as Record<string, string>,
        annPaths: {} as Record<string, string>,
    });
    const ctxRef = useRef(data);
    ctxRef.current = data;
    const quotaWarned = useRef(false);

    const persistRows = (
        rows: CaseRow[],
        extra?: { person?: string; dataType?: string; disease?: string; source?: string },
        slot?: { productId: number; kind: StatsKind },
    ) => {
        const cur = ctxRef.current;
        const item = {
            rows,
            person: extra?.person ?? cur.person ?? "",
            dataType: extra?.dataType ?? cur.dataType ?? "",
            disease: extra?.disease ?? cur.disease ?? "",
            source: extra?.source ?? cur.source ?? "",
        };
        const productId = slot ? slot.productId : (cur.productId || 0);
        const kind = slot ? slot.kind : (cur.kind as StatsKind);
        const ok = saveStatsCache(productId, kind, item);
        if (!ok && !quotaWarned.current) {
            quotaWarned.current = true;
            message.warning("本机缓存已满，本页加速可能失效；已写入数据文件的分布表和病例明细仍保留");
        }
    };

    useEffect(() => {
        const el = folderRef.current;
        if (!el) return;
        el.setAttribute("webkitdirectory", "");
        el.setAttribute("directory", "");
    }, []);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
        const last = readLastStats();
        if (!last) return;
        if (last.kind === "ann") {
            dispatch({
                productId: last.productId, kind: "ann", rows: [],
                person: last.item.person || "", dataType: last.item.dataType || "", disease: last.item.disease || "",
            });
            loadAnn(last.productId);
            return;
        }
        dispatch({
            productId: last.productId,
            kind: last.kind,
            rows: last.item.rows,
            person: last.item.person || "",
            dataType: last.item.dataType || "",
            disease: last.item.disease || "",
            source: last.item.source || "",
        });
    }, []);

    const loadFromDoc = (productId: number, kind: StatsKind) => {
        if (!productId) return;
        const meta = KIND_DOC[kind];
        Api.list_data_doc({ product_id: productId, doc_type: meta.type, page_index: 0, page_size: 1 }).then((list: any) => {
            if (list.code !== Api.C_OK) return;
            const hit = ((list.data && list.data.rows) || [])[0];
            if (!hit) return;
            return Api.get_data_doc({ id: hit.id }).then((got: any) => {
                if (got.code !== Api.C_OK) return;
                const item = caseRowsFromContent(got.data && got.data.content);
                const cur = ctxRef.current;
                if (!item || cur.productId !== productId || cur.kind !== kind || (cur.rows || []).length) return;
                if (kind === "ann" && (cur.annModule || (cur.annModules || []).length)) return;
                dispatch({
                    rows: item.rows,
                    person: item.person || cur.person,
                    dataType: item.dataType || cur.dataType,
                    disease: item.disease || cur.disease,
                    source: item.source || cur.source,
                });
                saveStatsCache(productId, kind, {
                    rows: item.rows,
                    person: item.person || cur.person || "",
                    dataType: item.dataType || cur.dataType || "",
                    disease: item.disease || cur.disease || "",
                    source: item.source || cur.source || "",
                });
            });
        });
    };

    /** 标注库：按章节模块列出页签；各模块病例先读本机缓存，没有再读标注统计表里按模块存的病例。 */
    const loadAnn = (productId: number) => {
        const empty = { annModules: [], annModule: "", annRows: {}, annSources: {}, annPaths: {} };
        if (!productId) {
            dispatch(empty);
            return;
        }
        dispatch({ ...empty, annPaths: readAnnPaths(productId) });
        ApiChapter.list_prod_algo_chapter({ prod_id: productId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (ctxRef.current.productId !== productId) return;
            const list = res && res.code === ApiChapter.C_OK ? ((res.data && res.data.rows) || []) : [];
            const modules: string[] = [];
            [...list]
                .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
                .forEach((r: any) => {
                    const name = String(r.name || "").trim();
                    if (name && !modules.includes(name)) modules.push(name);
                });
            const rowsBy: Record<string, CaseRow[]> = {};
            const srcBy: Record<string, string> = {};
            modules.forEach((m) => {
                const hit = readStatsCache(productId, annSlot(m));
                if (hit) {
                    rowsBy[m] = hit.rows;
                    srcBy[m] = hit.source || "";
                }
            });
            dispatch({ annModules: modules, annRows: rowsBy, annSources: srcBy });
            if (!modules.length) {
                const cur = ctxRef.current;
                if (cur.kind !== "ann") return;
                const hit = readStatsCache(productId, "ann");
                if (hit) {
                    dispatch({
                        rows: hit.rows, person: hit.person, dataType: hit.dataType,
                        disease: hit.disease, source: hit.source,
                    });
                } else {
                    loadFromDoc(productId, "ann");
                }
                return;
            }
            showAnnSummary(modules, rowsBy, srcBy);
            if (Object.keys(rowsBy).length) {
                showAnnSummary(modules, rowsBy, srcBy);
                return;
            }
            latestStatsDoc(productId, "ann").then((doc: any) => {
                const cur = ctxRef.current;
                if (!doc || cur.productId !== productId) return;
                const rec = ((doc.content && doc.content.sections) || []).find((n: any) => n && n.case_modules);
                const saved = (rec && rec.case_modules) || {};
                const fromDoc: Record<string, CaseRow[]> = {};
                const fromSrc: Record<string, string> = {};
                modules.forEach((m) => {
                    const one = saved[m];
                    if (!one || !Array.isArray(one.rows) || !one.rows.length) return;
                    fromDoc[m] = normalizeStatsRows(one.rows);
                    fromSrc[m] = String(one.source || "");
                    saveStatsCache(productId, annSlot(m), {
                        rows: fromDoc[m], person: cur.person || "", dataType: cur.dataType || "",
                        disease: cur.disease || "", source: fromSrc[m],
                    });
                });
                if (!Object.keys(fromDoc).length) return;
                dispatch({ annRows: fromDoc, annSources: fromSrc });
                showAnnSummary(modules, fromDoc, fromSrc);
            });
        }).catch(() => undefined);
    };

    const latestStatsDoc = (productId: number, kind: StatsKind) =>
        Api.list_data_doc({ product_id: productId, doc_type: KIND_DOC[kind].type, page_index: 0, page_size: 1 })
            .then((list: any) => {
                const hit = list && list.code === Api.C_OK ? ((list.data && list.data.rows) || [])[0] : null;
                if (!hit) return null;
                return Api.get_data_doc({ id: hit.id }).then((got: any) => (got && got.code === Api.C_OK ? got.data : null));
            })
            .catch(() => null);

    /** 汇总页签只展示各模块已读病例的合并结果；模块都未读则为空，不回退到整库旧病例。 */
    const showAnnSummary = (modules: string[], rowsBy: Record<string, CaseRow[]>, srcBy: Record<string, string>) => {
        const cur = ctxRef.current;
        if (cur.kind !== "ann" || cur.annModule) return;
        dispatch({ rows: mergeAnnRows(modules, rowsBy), source: joinAnnSources(modules, srcBy) });
    };

    const selectAnnModule = (module: string) => {
        const cur = ctxRef.current;
        if (!module) {
            dispatch({
                annModule: "",
                rows: mergeAnnRows(cur.annModules, cur.annRows),
                source: joinAnnSources(cur.annModules, cur.annSources),
            });
            return;
        }
        dispatch({ annModule: module, rows: cur.annRows[module] || [], source: cur.annSources[module] || "" });
    };

    const switchSlot = (productId: number, kind: StatsKind) => {
        if (kind === "ann" && productId) {
            dispatch({ productId, kind, rows: [], source: "", annModule: "" });
            loadAnn(productId);
            return;
        }
        const hit = readStatsCache(productId, kind);
        if (hit) {
            dispatch({
                productId, kind, rows: hit.rows, person: hit.person, dataType: hit.dataType,
                disease: hit.disease, source: hit.source, annModule: "",
            });
            return;
        }
        dispatch({ productId, kind, rows: [], person: data.person, dataType: data.dataType, disease: data.disease, source: "", annModule: "" });
        loadFromDoc(productId, kind);
    };

    const writeOneStatsDoc = (
        productId: number, kind: StatsKind, rows: CaseRow[], tlRows: any[], members: any[], source: string,
        annPack?: AnnPack | null,
    ) => {
        const cur = ctxRef.current;
        const meta = KIND_DOC[kind];
        const title = STATS_TITLES[kind];
        return Api.list_data_doc({ product_id: productId, doc_type: meta.type, page_index: 0, page_size: 1 }).then((list: any) => {
            if (list.code !== Api.C_OK) {
                return { status: "error", title: meta.title, msg: list.msg || "查询数据文件失败" };
            }
            const hit = ((list.data && list.data.rows) || [])[0];
            if (!hit) {
                return { status: "skip", title: meta.title, msg: `请先在数据文件新增「${meta.title}」，本次未写入统计表` };
            }
            const auto = autoStatsExtra(kind, members, tlRows, {
                person: cur.person, dataType: cur.dataType, disease: cur.disease,
            });
            return Api.get_data_doc({ id: hit.id }).then((got: any) => {
                if (got.code !== Api.C_OK) {
                    return { status: "error", title: meta.title, msg: got.msg || "打开统计表失败" };
                }
                const doc = got.data || {};
                const secs = (doc.content && doc.content.sections) || [];
                const kept = secs.filter((n: any) => isMetaSection(n));
                const rec = secs.find((n: any) => !isMetaSection(n));
                const grid = buildStatsGrid(title, rows, { ...auto, fileNo: doc.file_no || "" });
                const section: any = attachCaseRows({
                    title: rec?.title || "数据分布",
                    body: "",
                    tables: [grid],
                    children: [],
                }, {
                    rows,
                    person: auto.person || "",
                    dataType: auto.dataType || "",
                    disease: auto.disease || "",
                    source: source || "",
                });
                if (kind === "ann") {
                    if (annPack) {
                        const byModule: Record<string, { rows: CaseRow[]; source: string }> = {};
                        annPack.modules.forEach((m) => {
                            if ((annPack.rows[m] || []).length) {
                                byModule[m] = { rows: annPack.rows[m], source: annPack.sources[m] || "" };
                            }
                        });
                        section.case_modules = byModule;
                    } else if (rec && rec.case_modules) {
                        section.case_modules = rec.case_modules;
                    }
                }
                const next = [...kept, section];
                return Api.update_data_doc({
                    id: hit.id,
                    content: { sections: next },
                    product_id: doc.product_id,
                    version: doc.version,
                }).then((up: any) => {
                    if (up.code !== Api.C_OK) return { status: "error", title: meta.title, msg: up.msg || "写入统计表失败" };
                    return { status: "ok", title: meta.title, msg: "" };
                });
            });
        });
    };

    const writeStatsDoc = (productId: number, kind: StatsKind, rows: CaseRow[], source: string, annPack?: AnnPack | null) => {
        return Promise.all([
            ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
            ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
        ]).then(([tl, mb]: any[]) => {
            const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
            const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
            return Promise.all([writeOneStatsDoc(productId, kind, rows, tlRows, members, source, annPack)]).then((results) => {
                const ok = results.filter((r) => r.status === "ok");
                const skip = results.filter((r) => r.status === "skip");
                const failed = results.filter((r) => r.status === "error");
                return {
                    status: failed.length && !ok.length ? "error" : (ok.length ? "ok" : "skip"),
                    title: ok.map((r) => r.title).join("、"),
                    msg: skip.length ? `请先在数据文件新增「${skip.map((r) => r.title).join("、")}」，本次未写入统计表` : "",
                    errors: failed.map((r) => r.msg || `写入「${r.title}」失败`),
                };
            });
        });
    };

    const writeOneAnnot = (productId: number, meta: { type: string; title: string }, pids: string[], fill?: AnnotFillMeta) =>
        Api.list_data_doc({ product_id: productId, doc_type: meta.type, page_index: 0, page_size: 1 }).then((list: any) => {
            if (list.code !== Api.C_OK) return { title: meta.title, status: "error", msg: list.msg };
            const hit = ((list.data && list.data.rows) || [])[0];
            if (!hit) return { title: meta.title, status: "skip" };
            return Api.get_data_doc({ id: hit.id }).then((got: any) => {
                if (got.code !== Api.C_OK) return { title: meta.title, status: "error", msg: got.msg };
                const doc = got.data || {};
                const secs = (doc.content && doc.content.sections) || [];
                const kept = secs.filter((n: any) => isMetaSection(n));
                const rec = secs.find((n: any) => !isMetaSection(n));
                const srcTable = ((rec && rec.tables) || [])[0] || [];
                const table = fillPidTable(srcTable, pids, meta.type, fill);
                const next = [...kept, {
                    title: rec?.title || meta.title,
                    body: rec?.body || "",
                    tables: [table],
                    children: rec?.children || [],
                }];
                return Api.update_data_doc({
                    id: hit.id,
                    content: { sections: next },
                    product_id: doc.product_id,
                    version: doc.version,
                }).then((up: any) => {
                    if (up.code !== Api.C_OK) return { title: meta.title, status: "error", msg: up.msg };
                    return { title: meta.title, status: "ok" };
                });
            });
        });

    /** 记录名含某个模块名的，只写该模块的 PID（该模块还没读则不动）；对不上任何模块的写汇总 PID。 */
    const writeAnnotPids = async (productId: number, rows: CaseRow[], annPack?: AnnPack | null) => {
        const pids = pidsFromRows(rows);
        if (!pids.length) {
            return { ok: [] as string[], missing: 0, errors: [] as string[], warn: "病例明细没有可用 PID，未写入试标注/标注记录" };
        }
        const pidsFor = (title: string): string[] | null => {
            if (!annPack) return pids;
            const hit = annPack.modules.find((m) => {
                const k = moduleKey(m);
                return k.length >= 2 && title.includes(k);
            });
            if (!hit) return pids;
            const own = pidsFromRows(annPack.rows[hit] || []);
            return own.length ? own : null;
        };
        const [tl, mb] = await Promise.all([
            ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
            ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
        ]);
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        const ok: string[] = [];
        const errors: string[] = [];
        let missing = 0;
        for (let i = 0; i < ANN_PID_DOCS.length; i++) {
            const item = ANN_PID_DOCS[i];
            const list = pidsFor(item.title);
            if (!list) continue;
            const fill = buildAnnotMeta(item.type, tlRows, members);
            const r = await writeOneAnnot(productId, item, list, fill);
            if (r.status === "ok") ok.push(r.title);
            else if (r.status === "skip") missing += 1;
            else errors.push(r.msg || `写入「${r.title}」失败`);
        }
        return {
            ok,
            missing,
            errors,
            warn: !ok.length && missing ? "请先在数据文件新增试标注或标注记录，本次未写入" : "",
        };
    };

    const writeOneCollect = (productId: number, meta: { type: string; title: string }, fill: (secs: any[]) => Promise<any[]>) =>
        Api.list_data_doc({ product_id: productId, doc_type: meta.type, page_index: 0, page_size: 1 }).then((list: any) => {
            if (list.code !== Api.C_OK) return { title: meta.title, status: "error", msg: list.msg };
            const hit = ((list.data && list.data.rows) || [])[0];
            if (!hit) return { title: meta.title, status: "skip", msg: "" };
            return Api.get_data_doc({ id: hit.id }).then((got: any) => {
                if (got.code !== Api.C_OK) return { title: meta.title, status: "error", msg: got.msg };
                const doc = got.data || {};
                const secs = (doc.content && doc.content.sections) || [];
                return fill(secs).then((filled) => {
                    const next = stripKeys(filled);
                    if (JSON.stringify(next) === JSON.stringify(stripKeys(secs))) {
                        return { title: meta.title, status: "ok", msg: "" };
                    }
                    return Api.update_data_doc({
                        id: hit.id,
                        content: { sections: next },
                        product_id: doc.product_id,
                        version: doc.version,
                    }).then((up: any) => {
                        if (up.code !== Api.C_OK) return { title: meta.title, status: "error", msg: up.msg };
                        return { title: meta.title, status: "ok", msg: "" };
                    });
                });
            });
        });

    /** 原始库：回传→整理→上传（原始/基础段）。标注库：上传（标注段）→查重→标注需求反馈。基础库不写下游。 */
    const writeCollectDocs = async (productId: number, kind: StatsKind, rows: CaseRow[]) => {
        if (!productId || !(rows || []).length || kind === "base") {
            return { ok: [] as string[], missing: [] as string[], errors: [] as string[], warn: "" };
        }
        const wrote: { title: string; status: string; msg?: string }[] = [];
        if (kind === "raw") {
            wrote.push(await writeOneCollect(
                productId,
                { type: "dd_002", title: "多中心数据回传记录" },
                (secs) => fillDd002Hospitals(productId, secs, rows),
            ));
            wrote.push(await writeOneCollect(
                productId,
                { type: "dd_003", title: "数据整理记录" },
                (secs) => fillDd003FromReturn(productId, secs),
            ));
        }
        // 不传病例：医院行读刚写好的回传记录，标注数据量读标注库缓存或标注统计表，两段互不覆盖。
        wrote.push(await writeOneCollect(
            productId,
            { type: "dd_010", title: "数据库上传记录" },
            (secs) => fillDd010FromReturn(productId, secs),
        ));
        if (kind === "ann") {
            wrote.push(await writeOneCollect(
                productId,
                { type: "dd_012", title: "训练集测试集查重记录" },
                (secs) => fillDd012FromProduct(productId, secs),
            ));
            wrote.push(await writeOneCollect(
                productId,
                { type: "dd_011", title: "数据标注需求反馈" },
                (secs) => fillDd011Feedback(productId, secs, true),
            ));
        }
        const ok = wrote.filter((r) => r.status === "ok").map((r) => r.title);
        const missing = wrote.filter((r) => r.status === "skip").map((r) => r.title);
        const errors = wrote
            .filter((r) => r.status === "error")
            .map((r) => r.msg || `写入「${r.title}」失败`);
        return {
            ok,
            missing,
            errors,
            warn: missing.length ? `请先在数据文件新增「${missing.join("、")}」，本次未写入` : "",
        };
    };

    const writeDataFiles = (
        shownRows: CaseRow[],
        tip?: string | false,
        slot?: { productId: number; kind: StatsKind; source: string; annPack?: AnnPack },
    ) => {
        const cur = ctxRef.current;
        const productId = slot ? slot.productId : cur.productId;
        const kind = slot ? slot.kind : (cur.kind as StatsKind);
        let rows = shownRows;
        let source = slot ? slot.source : (cur.source || "");
        let annPack: AnnPack | null = null;
        if (kind === "ann") {
            annPack = slot?.annPack || (cur.productId === productId && cur.annModules.length
                ? { modules: cur.annModules, rows: cur.annRows, sources: cur.annSources }
                : null);
            const merged = annPack ? mergeAnnRows(annPack.modules, annPack.rows) : [];
            // 标注统计表始终写汇总；在模块页签上点写入也不会只剩这一个模块。
            if (merged.length) {
                rows = merged;
                source = joinAnnSources(annPack!.modules, annPack!.sources);
            } else {
                annPack = null;
            }
        }
        if (!productId) {
            if (typeof tip === "string") message.success(tip.replace(/，(并)?已写入.*$/, ""));
            else if (tip !== false) message.warning("请先选择产品，统计结果未写入数据文件");
            return Promise.resolve();
        }
        dispatch({ writing: true });
        return ensureMissingDocs(productId).then((ens) => {
            ens.errors.forEach((msg) => message.warning(msg));
            if (ens.created) message.success(`已按模板新建 ${ens.created} 份缺失文档`);
            return writeStatsDoc(productId, kind, rows, source, annPack);
        })
            .then((stats: any) => (kind === "ann" ? writeAnnotPids(productId, rows, annPack) : Promise.resolve(null))
                .then((ann: any) => ({ stats, ann })))
            .then(({ stats, ann }: any) => writeCollectDocs(productId, kind, rows).then((col: any) => ({ stats, ann, col })))
            .then(({ stats, ann, col }: any) => {
                const errors = [
                    ...((stats && stats.errors) || (stats?.status === "error" ? [stats.msg || "写入统计表失败"] : [])),
                    ...((ann && ann.errors) || []),
                    ...((col && col.errors) || []),
                ].filter(Boolean);
                const warns = [
                    stats?.msg,
                    ann && ann.warn,
                    col && col.warn,
                ].filter(Boolean);
                errors.forEach((msg: string) => message.error(msg));
                warns.forEach((msg: string) => message.warning(msg));
                if (tip === false) return;
                if (tip) {
                    message.success(errors.length ? String(tip).replace(/，(并)?已写入.*$/, "") : tip);
                } else if (stats?.status === "ok" || (ann && ann.ok && ann.ok.length) || (col && col.ok && col.ok.length)) {
                    message.success("已写入数据文件");
                }
            })
            .catch(() => {
                message.error("写入数据文件失败");
            })
            .finally(() => dispatch({ writing: false }));
    };

    const title = STATS_TITLES[data.kind as StatsKind];
    const extra = { dataType: data.dataType, disease: data.disease, person: data.person, source: data.source };
    const sheets: SheetAoa[] = useMemo(
        () => (data.rows || []).length ? buildWorkbookSheets(title, data.rows, extra) : [],
        [title, data.rows, data.dataType, data.disease, data.person, data.source],
    );
    const statsGrid = useMemo(() => buildStatsGrid(title, data.rows || [], extra), [title, data.rows, extra.dataType, extra.disease, extra.person]);
    const tableRows = useMemo(() => distRowsFromGrid(statsGrid), [statsGrid]);
    const total = (data.rows || []).length;
    const annByModule = data.kind === "ann" && (data.annModules || []).length > 0;
    const annOnSummary = annByModule && !data.annModule;
    const annMergedCount = useMemo(
        () => mergeAnnRows(data.annModules || [], data.annRows || {}).length,
        [data.annModules, data.annRows],
    );
    const detailRows = useMemo(
        () => (data.rows || []).map((r: CaseRow, i: number) => ({ key: i, ...r })),
        [data.rows],
    );
    const triageRows = useMemo(() => {
        const aoa = buildTriageAoa(data.rows || []);
        if (aoa.length < 2) return [];
        const list = aoa.slice(1).map((r, i) => ({
            key: i, Item: r[0], Catgory: r[1], pos_cases: r[2], neg_cases: r[3], Sen: r[4], Spe: r[5],
        }));
        // Item 相同的连续行合并：首行计算 rowSpan，后续行 rowSpan=0 隐藏
        const spans: Record<number, number> = {};
        let start = 0;
        for (let i = 1; i <= list.length; i++) {
            if (i === list.length || list[i].Item !== list[start].Item) {
                spans[start] = i - start;
                start = i;
            }
        }
        return list.map((r, i) => ({ ...r, itemSpan: spans[i] || 0 }));
    }, [data.rows]);
    const deviceRows = useMemo(() => triageRows.map((r) => ({
        key: r.key, Item: r.Item, Catgory: r.Catgory, pos_cases: r.pos_cases, neg_cases: r.neg_cases,
        itemSpan: (r as any).itemSpan,
    })), [triageRows]);

    type ReadSlot = { productId: number; kind: StatsKind; module: string; modules: string[] };

    const readSlotNow = (): ReadSlot => {
        const cur = ctxRef.current;
        const kind = cur.kind as StatsKind;
        const byModule = kind === "ann" && cur.annModules.length > 0;
        return {
            productId: cur.productId || 0,
            kind,
            module: byModule ? cur.annModule : "",
            modules: byModule ? [...cur.annModules] : [],
        };
    };

    /** 标注库按模块读取时要先选模块页签；没有模块的产品仍按整个标注库读取。 */
    const needAnnModule = (slot: ReadSlot) => {
        if (slot.kind === "ann" && slot.modules.length && !slot.module) {
            message.warning("请先在下方选择一个算法模块，再读取该模块的数据");
            return true;
        }
        return false;
    };

    /** 写回某个标注模块：只换这个模块的病例，再把各模块合成汇总写入标注统计表。 */
    const commitAnnModule = (rows: CaseRow[], source: string, slot: ReadSlot, tip: string | false) => {
        const cur = ctxRef.current;
        const sameProduct = cur.productId === slot.productId;
        const rowsBy: Record<string, CaseRow[]> = {};
        const srcBy: Record<string, string> = {};
        slot.modules.forEach((m) => {
            if (m === slot.module) {
                rowsBy[m] = rows;
                srcBy[m] = source;
                return;
            }
            const hit = sameProduct ? cur.annRows[m] : readStatsCache(slot.productId, annSlot(m))?.rows;
            if (hit && hit.length) rowsBy[m] = hit;
            const src = sameProduct ? cur.annSources[m] : readStatsCache(slot.productId, annSlot(m))?.source;
            if (src) srcBy[m] = src;
        });
        const merged = mergeAnnRows(slot.modules, rowsBy);
        const mergedSrc = joinAnnSources(slot.modules, srcBy);
        if (sameProduct) {
            const showing = cur.kind === "ann" && cur.annModule === slot.module;
            dispatch({
                loading: false, progress: "", annRows: rowsBy, annSources: srcBy,
                ...(showing ? { rows, source } : {}),
            });
        } else {
            dispatch({ loading: false, progress: "" });
        }
        persistRows(rows, { source }, { productId: slot.productId, kind: annSlot(slot.module) });
        persistRows(merged, { source: mergedSrc }, { productId: slot.productId, kind: "ann" });
        return writeDataFiles(merged, tip, {
            productId: slot.productId,
            kind: "ann",
            source: mergedSrc,
            annPack: { modules: slot.modules, rows: rowsBy, sources: srcBy },
        });
    };

    /** 读取开始时记下产品、库和模块；读取过程中切换了，结果仍只写回发起读取的那一处。 */
    const applyRows = (rows: CaseRow[], source: string, slot: ReadSlot) => {
        const cur = ctxRef.current;
        if (!rows.length) {
            dispatch({ loading: false, progress: "" });
            message.warning("未找到病例或无法读取 DICOM");
            return;
        }
        if (slot.module) {
            commitAnnModule(rows, source, slot, `已统计「${slot.module}」${rows.length} 个序列，已写入「${KIND_DOC.ann.title}」汇总`);
            return;
        }
        const same = cur.productId === slot.productId && cur.kind === slot.kind;
        dispatch(same ? { loading: false, progress: "", rows, source } : { loading: false, progress: "" });
        persistRows(rows, { source }, slot);
        writeDataFiles(rows, `已统计 ${rows.length} 个序列，已写入「${KIND_DOC[slot.kind].title}」`, { ...slot, source });
    };

    const pickFolder = () => {
        if (needAnnModule(readSlotNow())) return;
        if (!folderRef.current) return;
        folderRef.current.value = "";
        folderRef.current.click();
    };

    // 导入 gt/pred/dice Excel：按 TXID 匹配行填充三列
    const pickGpdExcel = () => {
        if (!total) {
            message.warning("请先选择病例文件夹或从服务器读取数据");
            return;
        }
        if (needAnnModule(readSlotNow())) return;
        if (!gpdExcelRef.current) return;
        gpdExcelRef.current.value = "";
        gpdExcelRef.current.click();
    };

    const onGpdExcel = (fileList: FileList | null) => {
        const file = fileList && fileList[0];
        if (!file) return;
        const slot = readSlotNow();
        dispatch({ loading: true, progress: "正在解析 Excel…" });
        importGpdExcel(data.rows || [], file).then((r) => {
            dispatch({ loading: false, progress: "" });
            if (!r.matched) {
                message.error("Excel 中的 TXID 与病例明细均不匹配，请检查 TXID 列");
                return;
            }
            let tip = `已匹配 ${r.matched} 行，已填入 gt/pred/dice`;
            if (r.unmatched.length) tip += `；${r.unmatched.length} 个 TXID 未匹配到病例`;
            if (slot.module) {
                commitAnnModule(r.rows, ctxRef.current.annSources[slot.module] || "", slot, false)
                    .then(() => message.success(tip, 6));
                return;
            }
            dispatch({ rows: r.rows });
            persistRows(r.rows);
            writeDataFiles(r.rows, false).then(() => message.success(tip, 6));
        }).catch((e: any) => {
            dispatch({ loading: false, progress: "" });
            message.error(e?.message || "导入失败，请检查 Excel 格式");
        });
    };

    const setKindPath = (kind: StatsKind, value: string) => {
        dispatch({ serverPaths: { ...(ctxRef.current.serverPaths || {}), [kind]: value } });
    };

    const setAnnPath = (productId: number, module: string, value: string) => {
        if (ctxRef.current.productId === productId) {
            dispatch({ annPaths: { ...(ctxRef.current.annPaths || {}), [module]: value } });
        }
        saveAnnPath(productId, module, value);
    };

    const pathOf = (slot: ReadSlot) => {
        const cur = ctxRef.current;
        return String(slot.module ? (cur.annPaths || {})[slot.module] || "" : (cur.serverPaths || {})[slot.kind] || "").trim();
    };

    /** 模块路径为空：从数据库上传记录标注表里数据集名含该模块名的行取存储路径。 */
    const resolveModulePath = async (slot: ReadSlot): Promise<string> => {
        const typed = pathOf(slot);
        if (typed || !slot.module || !slot.productId) return typed;
        const doc: any = await Api.list_data_doc({ product_id: slot.productId, doc_type: "dd_010", page_index: 0, page_size: 1 })
            .then((list: any) => {
                const hit = list && list.code === Api.C_OK ? ((list.data && list.data.rows) || [])[0] : null;
                return hit ? Api.get_data_doc({ id: hit.id }) : null;
            })
            .catch(() => null);
        const found = doc && doc.code === Api.C_OK ? annPathFromDd010(doc.data && doc.data.content, slot.module) : "";
        if (found) setAnnPath(slot.productId, slot.module, found);
        return found;
    };

    const scanServer = async () => {
        const cur = ctxRef.current;
        const slot = readSlotNow();
        if (needAnnModule(slot)) return;
        const path = await resolveModulePath(slot);
        if (slot.module && !path) {
            message.warning(`请填写「${slot.module}」的服务器路径（数据库上传记录里没有找到该模块的存储路径）`);
            return;
        }
        if (!path && !slot.productId) {
            message.warning("请填写服务器路径，或先选择产品以便从上传记录带出");
            return;
        }
        const remote = /^[\w.-]+:\//.test(path);
        if (remote && (!String(cur.serverUser || "").trim() || !String(cur.serverPass || ""))) {
            message.warning("请填写服务器用户名和密码");
            return;
        }
        const label = slot.module || KIND_DOC[slot.kind].title.replace(/统计表$/, "");
        dispatch({ loading: true, progress: `正在读取「${label}」DICOM…`, rows: [] });
        Api.scan_dicom_stats({
            path,
            product_id: slot.productId,
            kind: slot.kind,
            username: cur.serverUser || "",
            password: cur.serverPass || "",
        }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, progress: "" });
                message.error(res.msg || "读取失败");
                return;
            }
            const rows = ((res.data && res.data.rows) || []) as CaseRow[];
            const used = String((res.data && (res.data.path || res.data.root)) || path || "");
            if (used) {
                if (slot.module) setAnnPath(slot.productId, slot.module, used);
                else setKindPath(slot.kind, used);
            }
            const source = String((res.data && (res.data.path || res.data.root)) || "");
            applyRows(rows, source, slot);
        }).catch(() => {
            dispatch({ loading: false, progress: "" });
            message.error("读取失败");
        });
    };

    const saveXlsx = (list: SheetAoa[], fileTitle: string) => {
        const wb = XLSX.utils.book_new();
        list.forEach((sh) => {
            const ws = XLSX.utils.aoa_to_sheet(sh.rows);
            XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
        });
        XLSX.writeFile(wb, `${fileTitle}.xlsx`);
    };

    const onFolder = (fileList: FileList | null) => {
        if (!fileList || !fileList.length) return;
        const slot = readSlotNow();
        if (needAnnModule(slot)) return;
        dispatch({ loading: true, progress: "正在读取病例…", rows: [] });
        statsFromFiles(fileList, (done, all) => {
            dispatch({ progress: `正在读取 ${done}/${all}` });
        }).then((rows) => {
            applyRows(rows, "", slot);
        }).catch(() => {
            dispatch({ loading: false, progress: "", rows: [] });
            message.error("读取失败");
        });
    };

    const downloadXlsx = () => {
        if (!total) {
            message.warning("请先选择病例文件夹");
            return;
        }
        const fileTitle = annByModule && data.annModule ? `${title}-${data.annModule}` : title;
        saveXlsx(sheets, fileTitle);
        message.success(`已下载「${fileTitle}.xlsx」，请看 Excel 底部的多个工作表`, 8);
        if (ctxRef.current.productId) writeDataFiles(data.rows, false);
    };

    return (
        <div className="div-v page data-stats">
            <input
                ref={folderRef}
                type="file"
                multiple
                style={{ display: "none" }}
                // @ts-expect-error Chrome/Edge 选文件夹
                webkitdirectory=""
                onChange={(e) => onFolder(e.target.files)}
            />
            <input
                ref={gpdExcelRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => onGpdExcel(e.target.files)}
            />
            <div className="data-stats-toolbar">
                <span className="data-stats-label">选择产品：</span>
                <span className="data-stats-product">
                    <ProductVersionSelect
                        products={data.products}
                        value={data.productId || undefined}
                        includeAll
                        allowClear
                        namePlaceholder="产品名称"
                        versionPlaceholder="完整版本"
                        onChange={(v) => switchSlot(v || 0, data.kind as StatsKind)}
                    />
                </span>
                <Radio.Group
                    value={data.kind}
                    buttonStyle="solid"
                    onChange={(e) => switchSlot(data.productId || 0, e.target.value)}>
                    <Radio.Button value="raw">原始数据库</Radio.Button>
                    <Radio.Button value="base">基础数据库</Radio.Button>
                    <Radio.Button value="ann">标注数据库</Radio.Button>
                </Radio.Group>
                <Space>
                    <Button icon={<FolderOpenOutlined />} loading={data.loading || data.writing} disabled={annOnSummary} onClick={pickFolder}>
                        选择病例文件夹
                    </Button>
                    <Button type="primary" icon={<DownloadOutlined />} disabled={!total} onClick={downloadXlsx}>
                        下载 Excel
                    </Button>
                    <Button icon={<UploadOutlined />} disabled={!total || annOnSummary} loading={data.loading || data.writing} onClick={pickGpdExcel}>
                        导入 gt/pred/dice
                    </Button>
                    <Button disabled={!total} loading={data.writing} onClick={() => writeDataFiles(data.rows)}>
                        写入数据文件
                    </Button>
                </Space>
            </div>
            {annByModule ? (
                <Tabs
                    className="data-stats-modules"
                    size="small"
                    type="card"
                    activeKey={data.annModule || "__sum__"}
                    onChange={(k) => selectAnnModule(k === "__sum__" ? "" : k)}
                    items={[
                        {
                            key: "__sum__",
                            label: `汇总${annMergedCount ? ` ${annMergedCount}` : ""}`,
                        },
                        ...data.annModules.map((m: string) => {
                            const n = (data.annRows[m] || []).length;
                            return {
                                key: m,
                                label: (
                                    <span>
                                        {m}
                                        <span className={n ? "data-stats-module-count" : "data-stats-module-unread"}>
                                            {n ? n : "未读"}
                                        </span>
                                    </span>
                                ),
                            };
                        }),
                    ]}
                />
            ) : data.kind === "ann" && !data.productId ? (
                <div className="data-stats-hint">选择产品后，标注库按算法模块分别读取。</div>
            ) : null}
            <div className="data-stats-path">
                {annByModule ? (
                    <Input
                        addonBefore={data.annModule || "汇总"}
                        disabled={!data.annModule}
                        placeholder={data.annModule
                            ? "该模块的服务器路径；空则按数据库上传记录里该模块数据集的存储路径"
                            : "汇总不能读取，请选择一个模块"}
                        value={data.annModule ? (data.annPaths || {})[data.annModule] || "" : ""}
                        onChange={(e) => setAnnPath(data.productId || 0, data.annModule, e.target.value)}
                        onPressEnter={scanServer}
                    />
                ) : (
                    <Input
                        addonBefore={KIND_DOC[data.kind as StatsKind].title.replace(/统计表$/, "")}
                        placeholder="服务器路径，如 172.16.8.93:/data/dicom/ct-dr-hj；空则按该库上传记录的存储路径"
                        value={(data.serverPaths || {})[data.kind as StatsKind] || ""}
                        onChange={(e) => setKindPath(data.kind as StatsKind, e.target.value)}
                        onPressEnter={scanServer}
                    />
                )}
                <Input
                    placeholder="用户名"
                    value={data.serverUser}
                    onChange={(e) => dispatch({ serverUser: e.target.value })}
                    onPressEnter={scanServer}
                    style={{ width: 160, maxWidth: 160, minWidth: 140 }}
                />
                <Input.Password
                    placeholder="密码"
                    value={data.serverPass}
                    onChange={(e) => dispatch({ serverPass: e.target.value })}
                    onPressEnter={scanServer}
                    className="data-stats-pass"
                    style={{ width: 160, maxWidth: 160, minWidth: 140 }}
                    visibilityToggle
                />
                <Button
                    icon={<CloudServerOutlined />}
                    loading={data.loading || data.writing}
                    disabled={annOnSummary}
                    onClick={scanServer}>
                    从服务器读取
                </Button>
            </div>
            {data.source ? (
                <div className="data-stats-source">数据来源：{data.source}</div>
            ) : null}
            {data.progress ? <span className="data-stats-progress">{data.progress}</span> : null}
            <Spin spinning={data.loading} wrapperClassName="data-stats-table">
                <Tabs
                    animated={{ inkBar: true, tabPane: false }}
                    items={[
                        {
                            key: "detail",
                            label: `病例明细${total ? `（${total}）` : ""}`,
                            children: (
                                <Table
                                    size="small"
                                    pagination={{
                                        pageSize: data.pageSize || 50,
                                        showSizeChanger: true,
                                        pageSizeOptions: [10, 20, 50, 100],
                                        onChange: (_page, size) => {
                                            if (size) dispatch({ pageSize: size });
                                        },
                                    }}
                                    scroll={{ x: 1300 }}
                                    dataSource={detailRows}
                                    columns={DETAIL_COLUMNS.map((c) => ({
                                        title: c === "TXID" ? "TXID（病例文件夹）" : c,
                                        dataIndex: c, ellipsis: true, width: c === "TXID" ? 180 : 130,
                                        render: (c === "gt" || c === "pred" || c === "dice")
                                            ? (v: any) => (v == null || String(v).trim() === "" ? "/" : v)
                                            : undefined,
                                    }))}
                                    locale={{ emptyText: "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "dist",
                            label: "数据分布",
                            children: (
                                <Table
                                    size="small"
                                    pagination={false}
                                    dataSource={tableRows}
                                    columns={[
                                        { title: "因素", dataIndex: "factor", width: 120 },
                                        { title: "类别", dataIndex: "category" },
                                        { title: "序列数", dataIndex: "count", width: 120 },
                                        { title: "占比", dataIndex: "ratio", width: 140 },
                                    ]}
                                    locale={{ emptyText: "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "triage",
                            label: "统计结果",
                            children: (
                                <Table
                                    size="small"
                                    pagination={false}
                                    scroll={{ x: 720 }}
                                    dataSource={triageRows}
                                    columns={[
                                        {
                                            title: "因素", dataIndex: "Item", width: 120,
                                            onCell: (r: any) => ({ rowSpan: (r as any).itemSpan || 0 }),
                                        },
                                        { title: "类别", dataIndex: "Catgory" },
                                        { title: "阳性病例数", dataIndex: "pos_cases", width: 110 },
                                        { title: "阴性病例数", dataIndex: "neg_cases", width: 110 },
                                        { title: "灵敏度", dataIndex: "Sen", width: 80 },
                                        { title: "特异度", dataIndex: "Spe", width: 80 },
                                    ]}
                                    locale={{ emptyText: total ? "暂无统计结果" : "请选择病例文件夹" }}
                                />
                            ),
                        },
                        {
                            key: "device",
                            label: "设备分布",
                            children: (
                                <div className="data-stats-device">
                                    <Table
                                        size="small"
                                        pagination={false}
                                        scroll={{ x: 640 }}
                                        dataSource={deviceRows}
                                        columns={[
                                            {
                                                title: "因素", dataIndex: "Item", width: 120,
                                                onCell: (r: any) => ({ rowSpan: (r as any).itemSpan || 0 }),
                                            },
                                            { title: "类别", dataIndex: "Catgory" },
                                            { title: "阳性病例数", dataIndex: "pos_cases", width: 110 },
                                            { title: "阴性病例数", dataIndex: "neg_cases", width: 110 },
                                        ]}
                                        locale={{ emptyText: total ? "暂无设备分布" : "请选择病例文件夹" }}
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            </Spin>
        </div>
    );
};
