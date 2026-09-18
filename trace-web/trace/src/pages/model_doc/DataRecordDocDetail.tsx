import { Button, Checkbox, DatePicker, Input, Select, Space, Spin, Upload, message } from "antd";
import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { useData } from "@/common";
import * as Api from "@/api/ApiDataDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiHospital from "@/api/ApiProdHospital";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { getDataDocMeta, DATA_STATS_IMPORT_TYPES, getDataDocListType } from "./DataDocTypes";
import { ANN_PID_TYPES, annotTableSig, applyPidsToSections, attachCaseRows, autoStatsExtra, buildAnnotMeta, buildStatsGrid, caseRowsFromContent, pidsFromCache, readLastStats, readStatsCache, STATS_TITLES, StatsKind } from "../data_stats/dataStatsLocal";
import { computeGridSpans } from "./gridSpans";
import "../pdp/PdpDocDetail.less";

const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%", marginBottom: 16, tableLayout: "fixed" };
const PATH_LABELS = new Set(["存储路径"]);
const uploadColMin = (label: string) => {
    const t = String(label || "").trim();
    if (t === "数据所属项目" || t === "数据所属医院") return 168;
    if (t === "医院编号") return 108;
    if (t.includes("上传日期") || t === "上传人员") return 100;
    if (t.includes("上传数据量") || t.includes("上传数量")) return 92;
    if (t === "存储路径") return 320;
    if (t === "数据集") return 140;
    return 96;
};
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
    return !t || /^Sheet\d*$/i.test(t) || /^工作表\d*$/.test(t)
        || t === "训练集调优集查重" || t === "原始" || t === "基础" || t === "标注";
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

const isSignLabel = (s: string) => /^(评估人|复核人|记录人|审核人)/.test(String(s || "").trim());
const isSignRow = (row: any[]) => (row || []).some((c: any) => isSignLabel(String(c ?? "")));
const isDailyFootRow = (row: any[]) => (row || []).some((c: any) => /记录人签字|审核人签字/.test(String(c ?? "")));
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

const computeRecordSpans = (grid: any[][], emptyMergeRows?: Set<number>) => {
    const spans = computeGridSpans(grid);
    const rows = grid || [];
    const R = rows.length;
    const C = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const at = (r: number, c: number) => String(rows[r]?.[c] ?? "");
    const allowEmpty = (r: number) => !emptyMergeRows || emptyMergeRows.has(r);
    for (let r = 0; r < R; r++) {
        if (rowAllEmpty(rows[r], C) || isSignRow(rows[r]) || !allowEmpty(r)) continue;
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
        if (emptyMergeRows && !allowEmpty(r)) continue;
        for (let c = 0; c < C; c++) {
            if (spans[r][c].skip || !at(r, c).trim()) continue;
            const cs = spans[r][c].colSpan;
            let r2 = r;
            while (r2 + 1 < R) {
                if (rowAllEmpty(rows[r2 + 1], C) || isSignRow(rows[r2 + 1]) || !allowEmpty(r2 + 1)) break;
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

/** 名单块只合并左侧标签列（参与培训人员名单等），姓名格仍不横向撑开。 */
const mergeNameLabelCol = (grid: any[][], spans: ReturnType<typeof computeRecordSpans> | null, nameRows: Set<number>) => {
    if (!spans || !nameRows.size) return spans;
    const rows = grid || [];
    rows.forEach((row, r) => {
        if (!nameRows.has(r)) return;
        const label = String(row?.[0] ?? "").replace(/\s+/g, "");
        if (!label) return;
        let r2 = r;
        while (nameRows.has(r2 + 1) && !String(rows[r2 + 1]?.[0] ?? "").replace(/\s+/g, "")) r2 += 1;
        if (r2 <= r || !spans[r]?.[0] || spans[r][0].skip) return;
        spans[r][0].rowSpan = r2 - r + 1;
        for (let k = r + 1; k <= r2; k++) {
            if (spans[k]?.[0]) spans[k][0].skip = true;
        }
    });
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
                const label = String(next[0] ?? "").trim();
                if (label !== "所属项目" && label !== "数据所属项目") {
                    const mapped = productValueForLabel(label, info);
                    while (next.length < 2) next.push("");
                    next[1] = put(next[1], mapped);
                }
            }
            if (headerIdx >= 0 && ri > headerIdx) {
                for (let c = 0; c < cols; c++) {
                    const label = colLabel[c] || "";
                    if (label === "所属项目" || label === "数据所属项目") continue;
                    const mapped = productValueForLabel(label, info);
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

type Qty3 = { train: string; tune: string; test: string };
const emptyQty = (): Qty3 => ({ train: "", tune: "", test: "" });

const excelSerialToDot = (s: string) => {
    const t = String(s || "").trim();
    if (!/^\d{4,6}$/.test(t)) return "";
    const n = Number(t);
    if (n < 20000 || n > 80000) return "";
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
};

const parseDotDate = (s: string) => {
    const serial = excelSerialToDot(s);
    if (serial) return serial;
    const m = String(s || "").match(/(\d{4})[.年/\-](\d{1,2})[.月/\-](\d{1,2})/);
    return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : "";
};

const dateKey = (dot: string) => {
    const m = String(dot || "").match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
};

const walkDocSections = (nodes: any[], fn: (n: any) => void) => {
    (nodes || []).forEach((n: any) => {
        if (!n) return;
        fn(n);
        walkDocSections(n.children || [], fn);
    });
};

const parseMd003Req = (content: any) => {
    const pe = emptyQty();
    const lobe = emptyQty();
    let deliver = "";
    let lastKind = "";
    const takeQty = (body: string, dest: Qty3) => {
        const train = body.match(/训练数据量要求[：:]\s*(\d+)/);
        const tune = body.match(/调优数据量要求[：:]\s*(\d+)/);
        const test = body.match(/测试数据量要求[：:]\s*(\d+)/);
        if (train) dest.train = train[1];
        if (tune) dest.tune = tune[1];
        if (test) dest.test = test[1];
        const dm = body.match(/交付时间[\s\S]{0,40}?(\d{4}[.年/\-]\d{1,2}[.月/\-]\d{1,2})/);
        if (dm) deliver = parseDotDate(dm[1]) || deliver;
    };
    walkDocSections((content && content.sections) || [], (n) => {
        const title = stripNum(n.title);
        const body = String(n.body || "");
        const blob = title + body;
        if (title === "标注规则" || title.includes("肺叶") || title.includes("肺栓塞")) {
            if (blob.includes("肺叶")) lastKind = "lobe";
            if (blob.includes("肺栓塞")) lastKind = "pe";
        }
        if (title !== "数据") return;
        let kind = lastKind;
        if (body.includes("交付时间")) kind = "pe";
        else if (!kind) kind = body.includes("肺叶") ? "lobe" : "pe";
        takeQty(body, kind === "lobe" ? lobe : pe);
    });
    return { pe, lobe, deliver };
};

const parseDd010Counts = (content: any) => {
    const counts: Record<string, string> = {};
    const dates: string[] = [];
    walkDocSections((content && content.sections) || [], (n) => {
        const t = String(n.title || "").replace(/\s/g, "");
        (n.tables || []).forEach((tb: any[]) => {
            if (!Array.isArray(tb) || !tb.length) return;
            const first = (Array.isArray(tb[0]) ? tb[0] : []).map((c: any) => String(c || "")).join("");
            if (t !== "标注" && !first.includes("标注数据库")) return;
            let nameI = -1;
            let qtyI = -1;
            let dateI = -1;
            tb.forEach((row: any[]) => {
                if (!Array.isArray(row)) return;
                const cells = row.map((c) => String(c ?? "").trim());
                if (cells.includes("数据集") && cells.some((x) => x.includes("数据量"))) {
                    nameI = cells.indexOf("数据集");
                    qtyI = cells.findIndex((x) => x.includes("数据量"));
                    dateI = cells.findIndex((x) => x.includes("上传日期") || x === "时间");
                    return;
                }
                if (nameI < 0) return;
                const name = cells[nameI] || "";
                const qty = cells[qtyI] || "";
                if (name && qty && name !== "数据集") {
                    counts[name] = qty.replace(/\.0+$/, "").split(".")[0];
                }
                if (dateI >= 0) {
                    const d = parseDotDate(cells[dateI] || "");
                    if (d) dates.push(d);
                }
            });
        });
    });
    let latest = "";
    dates.forEach((d) => { if (dateKey(d) >= dateKey(latest)) latest = d; });
    return { counts, date: latest };
};

const parseDd012Counts = (content: any) => {
    const counts: Record<string, string> = {};
    walkDocSections((content && content.sections) || [], (n) => {
        (n.tables || []).forEach((tb: any[]) => {
            let nameI = -1;
            let qtyI = -1;
            (tb || []).forEach((row: any[]) => {
                if (!Array.isArray(row)) return;
                const cells = row.map((c) => String(c ?? "").trim());
                if (cells.includes("批次") && cells.includes("数据量")) {
                    nameI = cells.indexOf("批次");
                    qtyI = cells.indexOf("数据量");
                    return;
                }
                if (nameI < 0) return;
                const name = cells[nameI] || "";
                const qty = cells[qtyI] || "";
                if (name && qty && name !== "批次") {
                    counts[name] = qty.replace(/\.0+$/, "").split(".")[0];
                }
            });
        });
    });
    return counts;
};

const qtyFromNames = (counts: Record<string, string>, names: [string, string, string]): Qty3 => ({
    train: counts[names[0]] || "",
    tune: counts[names[1]] || "",
    test: counts[names[2]] || "",
});

const fmtPeReq = (q: Qty3) => (q.train && q.tune && q.test
    ? `1.肺栓塞分割训练集：${q.train}\n  肺栓塞分割调优集：${q.tune}\n  多中心客观测试集:${q.test}` : "");
const fmtLobeReq = (q: Qty3) => (q.train && q.tune && q.test
    ? `2.肺叶分割训练集：${q.train}\n  肺叶分割调优集：${q.tune}\n  肺叶分测试集: ${q.test}` : "");
const fmtPeAct = (q: Qty3) => (q.train && q.tune && q.test
    ? `1.肺栓塞分割训练集：${q.train}\n  肺栓塞分割调优集：${q.tune}\n  肺栓塞分诊测试集:${q.test}` : "");
const fmtLobeAct = (q: Qty3) => (q.train && q.tune && q.test
    ? `2.肺叶分割训练集：${q.train}\n  肺叶分割调优集：${q.tune}\n  肺叶分割测试集: ${q.test}` : "");

const applyDd011Table = (nodes: any[], src: {
    peTypeReq?: string; peTypeAct?: string;
    lobeTypeReq?: string; lobeTypeAct?: string;
    peQtyReq?: string; peQtyAct?: string;
    lobeQtyReq?: string; lobeQtyAct?: string;
    deliverReq?: string; deliverAct?: string;
}) => {
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb)) return tb;
        const hit = (tb || []).some((row) =>
            Array.isArray(row)
            && String(row[0] ?? "").trim() === "评估要点"
            && String(row[1] ?? "").includes("文档需求")
        );
        if (!hit) return tb;
        let prev = "";
        return tb.map((row: any[]) => {
            if (!Array.isArray(row)) return row;
            const label = String(row[0] ?? "").trim();
            if (label) prev = label;
            const req = String(row[1] ?? "");
            const next = [...row];
            const put = (ci: number, val?: string) => {
                if (!val) return;
                while (next.length <= ci) next.push("");
                next[ci] = val;
            };
            if (prev === "标注类型") {
                if (req.includes("肺叶") || /^2[.]/.test(req.trim())) {
                    put(1, src.lobeTypeReq);
                    put(3, src.lobeTypeAct);
                } else if (req.includes("肺栓塞") || /^1[.]/.test(req.trim()) || label === "标注类型") {
                    put(1, src.peTypeReq);
                    put(3, src.peTypeAct);
                }
            } else if (prev === "数据量") {
                if (req.includes("肺叶")) {
                    put(1, src.lobeQtyReq);
                    put(3, src.lobeQtyAct);
                } else if (req.includes("肺栓塞") || label === "数据量") {
                    put(1, src.peQtyReq);
                    put(3, src.peQtyAct);
                }
            } else if (label === "交付时间") {
                put(1, src.deliverReq || excelSerialToDot(req));
                put(3, src.deliverAct || excelSerialToDot(String(row[3] ?? "")));
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

const latestDataDoc = (productId: number, docType: string) =>
    Api.list_data_doc({ product_id: productId, doc_type: docType, page_index: 0, page_size: 1 })
        .then((res: any) => (res && res.code === Api.C_OK ? (((res.data && res.data.rows) || [])[0] || null) : null))
        .catch(() => null);

const fillDd011Feedback = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        latestDataDoc(productId, "md_003"),
        latestDataDoc(productId, "dd_010"),
        latestDataDoc(productId, "dd_012"),
    ]).then(([md003, dd010, dd012]: any[]) => {
        const req = parseMd003Req(md003 && md003.content);
        const up = parseDd010Counts(dd010 && dd010.content);
        const counts = { ...parseDd012Counts(dd012 && dd012.content), ...up.counts };
        const peAct = qtyFromNames(counts, ["肺栓塞分割训练集", "肺栓塞分割调优集", "肺栓塞分诊测试集"]);
        const lobeAct = qtyFromNames(counts, ["肺叶分割训练集", "肺叶分割调优集", "肺叶分割测试集"]);
        const hasPeReq = !!(req.pe.train || req.pe.tune || req.pe.test);
        const hasLobeReq = !!(req.lobe.train || req.lobe.tune || req.lobe.test);
        const hasPeAct = !!(peAct.train || peAct.tune || peAct.test);
        const hasLobeAct = !!(lobeAct.train || lobeAct.tune || lobeAct.test);
        return applyDd011Table(secs, {
            peTypeReq: hasPeReq ? "1.肺栓塞分割" : "",
            peTypeAct: hasPeAct ? "1.肺栓塞分割/分诊" : "",
            lobeTypeReq: hasLobeReq ? "2.肺叶分割" : "",
            lobeTypeAct: hasLobeAct ? "2.肺叶分割" : "",
            peQtyReq: fmtPeReq(req.pe),
            lobeQtyReq: fmtLobeReq(req.lobe),
            peQtyAct: fmtPeAct(peAct),
            lobeQtyAct: fmtLobeAct(lobeAct),
            deliverReq: req.deliver,
            deliverAct: up.date || req.deliver,
        });
    }).catch(() => secs);
};

const recvDatesFromTimeline = (tlRows: any[]) => {
    const seen: Record<string, true> = {};
    const out: Array<{ k: number; s: string }> = [];
    (tlRows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const text = String((r.cells || {})["数据部"] || "");
        if (!text.includes("回传") && !text.includes("多中心")) return;
        const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
        const y = num(r.year);
        const m = num(r.month);
        const d = num(r.day);
        if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return;
        const k = y * 10000 + m * 100 + d;
        const s = `${y}.${m}.${d}`;
        if (seen[s]) return;
        seen[s] = true;
        out.push({ k, s });
    });
    return out.sort((a, b) => a.k - b.k).map((x) => x.s);
};

const datesFromTimeline = (tlRows: any[], key: string) => {
    const seen: Record<string, true> = {};
    const out: Array<{ k: number; s: string }> = [];
    (tlRows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const text = String((r.cells || {})["数据部"] || "");
        if (!text.includes(key)) return;
        const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
        const y = num(r.year);
        const m = num(r.month);
        const d = num(r.day);
        if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return;
        const k = y * 10000 + m * 100 + d;
        const s = `${y}.${m}.${d}`;
        if (seen[s]) return;
        seen[s] = true;
        out.push({ k, s });
    });
    return out.sort((a, b) => a.k - b.k).map((x) => x.s);
};

const examDatesFromTimeline = (tlRows: any[], docType: string) => {
    if (!/^dd_013_0[1-4]$/.test(docType)) return [];
    const kind = /dd_013_0[24]/.test(docType) ? "肺叶" : "肺栓塞";
    const pick = (pred: (t: string) => boolean) => {
        const seen: Record<string, true> = {};
        const out: Array<{ k: number; s: string }> = [];
        (tlRows || []).forEach((r: any) => {
            if ((r.row_type || "date") !== "date") return;
            const text = String((r.cells || {})["数据部"] || "");
            if (!pred(text)) return;
            const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
            const y = num(r.year);
            const m = num(r.month);
            const d = num(r.day);
            if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return;
            const k = y * 10000 + m * 100 + d;
            const s = `${y}.${m}.${d}`;
            if (seen[s]) return;
            seen[s] = true;
            out.push({ k, s });
        });
        return out.sort((a, b) => a.k - b.k).map((x) => x.s);
    };
    let dates = pick((t) => t.includes("考核") && t.includes(kind));
    if (!dates.length) dates = pick((t) => (t.includes("人员培训") || t.includes("培训记录")) && t.includes(kind));
    return dates;
};

const examTimeText = (docType: string, dates: string[]) => {
    if (!dates.length) return "";
    if (/^dd_013_0[12]$/.test(docType)) return dates[0];
    return dates.join("\n");
};

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

const toDashDate = (s: string) => {
    const t = String(s || "").trim();
    const m = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (!m) return "";
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1) return "";
    return `${y}-${pad2(mo)}-${pad2(d)}`;
};

const nextDashDate = (s: string) => {
    const dash = toDashDate(s);
    if (!dash) return "";
    const [y, mo, d] = dash.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(Date.UTC(y, mo - 1, d + 1));
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

const dailyDatesFromTimeline = (tlRows: any[], docType: string) => {
    if (!/^dd_013_0[567]$/.test(docType)) return [];
    const pick = (pred: (t: string) => boolean) => {
        const seen: Record<string, true> = {};
        const out: Array<{ k: number; s: string }> = [];
        (tlRows || []).forEach((r: any) => {
            if ((r.row_type || "date") !== "date") return;
            const text = String((r.cells || {})["数据部"] || "");
            if (!pred(text)) return;
            const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
            const y = num(r.year);
            const m = num(r.month);
            const d = num(r.day);
            if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return;
            const k = y * 10000 + m * 100 + d;
            const s = `${y}-${pad2(m)}-${pad2(d)}`;
            if (seen[s]) return;
            seen[s] = true;
            out.push({ k, s });
        });
        return out.sort((a, b) => a.k - b.k).map((x) => x.s);
    };
    const annot = (t: string) => {
        if (docType === "dd_013_05") return t.includes("标注记录") && t.includes("肺栓塞分割") && !t.includes("试标注") && !t.includes("分诊");
        if (docType === "dd_013_06") return t.includes("标注记录") && t.includes("肺叶") && !t.includes("试标注");
        if (docType === "dd_013_07") return t.includes("标注记录") && t.includes("分诊") && !t.includes("试标注");
        return false;
    };
    const kind = docType === "dd_013_06" ? "肺叶" : "肺栓塞";
    let dates = pick(annot);
    if (!dates.length) dates = pick((t) => t.includes("考核") && t.includes(kind));
    if (!dates.length) dates = pick((t) => (t.includes("人员培训") || t.includes("培训记录")) && t.includes(kind));
    return dates;
};

const hospitalNoFromTxid = (txid: any): string => {
    const txt = String(txid || "").trim();
    if (!txt) return "";
    const m = txt.match(/^([A-Za-z0-9]+)/);
    return m ? m[1] : txt;
};

const countCasesByHospitalNo = (rows: any[]): Record<string, number> => {
    const map: Record<string, number> = {};
    (rows || []).forEach((r) => {
        const no = hospitalNoFromTxid(r && r.TXID);
        if (!no) return;
        const key = no.toUpperCase();
        map[key] = (map[key] || 0) + 1;
    });
    return map;
};

const uniqueHospitalNosFromCases = (rows: any[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    (rows || []).forEach((r) => {
        const no = hospitalNoFromTxid(r && r.TXID);
        if (!no) return;
        const key = no.toUpperCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(key);
    });
    return out;
};

const packDd002Cases = (rows: any[]): { qty: Record<string, number>; order: string[] } | null => {
    if (!rows || !rows.length) return null;
    return { qty: countCasesByHospitalNo(rows), order: uniqueHospitalNosFromCases(rows) };
};

const loadDd002Cases = (productId: number): Promise<{ qty: Record<string, number>; order: string[] } | null> => {
    if (!productId) return Promise.resolve(null);
    const cached = readStatsCache(productId, "raw") || readStatsCache(productId, "base") || readStatsCache(productId, "ann");
    if (cached && cached.rows && cached.rows.length) return Promise.resolve(packDd002Cases(cached.rows));
    const types = ["dd_015_01", "dd_015_02", "dd_015_03"];
    const next = (i: number): Promise<{ qty: Record<string, number>; order: string[] } | null> => {
        if (i >= types.length) return Promise.resolve(null);
        return latestDataDoc(productId, types[i]).then((doc: any) => {
            const hit = caseRowsFromContent(doc && doc.content);
            if (hit && hit.rows && hit.rows.length) return packDd002Cases(hit.rows);
            return next(i + 1);
        });
    };
    return next(0);
};

const applyDd002Hospitals = (nodes: any[], hospitals: Array<{ org_name: string; hospital_no: string }>, recvDates: string[], collectors: string[], qtyByHospital: Record<string, number> | null) => {
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        let headerIdx = -1;
        let nameI = -1;
        let noI = -1;
        let typeI = -1;
        let methodI = -1;
        let dateI = -1;
        let personI = -1;
        let retI = -1;
        let actI = -1;
        tb.forEach((row, ri) => {
            if (!Array.isArray(row) || headerIdx >= 0) return;
            const cells = row.map((c) => String(c ?? "").trim());
            if (cells.includes("数据来源") && cells.includes("医院编号")) {
                headerIdx = ri;
                nameI = cells.indexOf("数据来源");
                noI = cells.indexOf("医院编号");
                typeI = cells.indexOf("数据类型");
                methodI = cells.indexOf("数据回传方式");
                dateI = cells.indexOf("数据接收时间");
                personI = cells.indexOf("数据采集负责人");
                retI = cells.indexOf("回传数据量");
                actI = cells.indexOf("实际接收量");
            }
        });
        if (headerIdx < 0 || nameI < 0 || noI < 0) return tb;
        let signIdx = tb.length;
        for (let i = headerIdx + 1; i < tb.length; i++) {
            if (isSignRow(tb[i])) { signIdx = i; break; }
        }
        let footerStart = signIdx;
        while (footerStart > headerIdx + 1 && rowAllEmpty(tb[footerStart - 1], cols)) footerStart -= 1;
        const oldData = tb.slice(headerIdx + 1, footerStart).filter((row) => Array.isArray(row) && !rowAllEmpty(row, cols));
        const defaultType = typeI >= 0
            ? String(oldData[0]?.[typeI] ?? "").trim()
            : String(oldData[0]?.[0] ?? "").trim();
        const used = new Set<number>();
        const pick = (no: string, name: string) => {
            let idx = oldData.findIndex((r, i) => !used.has(i) && no && String(r[noI] ?? "").trim() === no);
            if (idx < 0) idx = oldData.findIndex((r, i) => !used.has(i) && name && String(r[nameI] ?? "").trim() === name);
            if (idx < 0) return null;
            used.add(idx);
            return [...oldData[idx]];
        };
        let datePtr = 0;
        let personPtr = 0;
        const qtyOf = (no: string) => {
            if (!qtyByHospital) return null;
            const key = String(no || "").trim();
            if (!key) return 0;
            if (qtyByHospital[key] != null) return qtyByHospital[key];
            const hit = Object.keys(qtyByHospital).find((k) => k.toUpperCase() === key.toUpperCase());
            return hit ? qtyByHospital[hit] : 0;
        };
        const newData = hospitals.map((h) => {
            const no = String(h.hospital_no || "").trim();
            const name = String(h.org_name || "").trim();
            const next = pick(no, name) || new Array(cols).fill("");
            while (next.length < cols) next.push("");
            next[nameI] = name;
            next[noI] = no;
            if (typeI >= 0 && !String(next[typeI] ?? "").trim() && defaultType) next[typeI] = defaultType;
            if (methodI >= 0) next[methodI] = "硬盘邮寄";
            if (dateI >= 0 && !String(next[dateI] ?? "").trim() && recvDates.length) {
                next[dateI] = recvDates[datePtr % recvDates.length];
                datePtr += 1;
            }
            if (personI >= 0 && collectors.length) {
                next[personI] = collectors[personPtr % collectors.length];
                personPtr += 1;
            }
            const qty = qtyOf(no);
            if (qty != null) {
                if (retI >= 0) next[retI] = String(qty);
                if (actI >= 0) next[actI] = String(qty);
            }
            return next;
        });
        return [...tb.slice(0, headerIdx + 1), ...newData, ...tb.slice(footerStart)];
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const DEFAULT_COLLECTORS = ["周中亚", "李鹏飞", "耿景辉", "刘新阳", "王振宇", "王慧阳"];

const ensureCollectors = (productId: number, members: any[]): Promise<string[]> => {
    const existing = (members || [])
        .filter((m: any) => String(m.role || "").trim() === "数据采集人员")
        .map((m: any) => String(m.name || "").trim())
        .filter(Boolean);
    if (existing.length) return Promise.resolve(existing);
    let sort = (members || []).reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
    return Promise.all(DEFAULT_COLLECTORS.map((name) => {
        sort += 1;
        return ApiMember.add_project_member({ prod_id: productId, role: "数据采集人员", name, sort_order: sort });
    })).then(() => DEFAULT_COLLECTORS).catch(() => DEFAULT_COLLECTORS);
};

const fillDd002Hospitals = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        ApiHospital.list_prod_hospital({ prod_id: productId, page_index: 0, page_size: 5000 }),
        ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
        loadDd002Cases(productId).catch(() => null),
    ]).then(([res, tl, mb, cases]: any[]) => {
        if (!res || res.code !== ApiHospital.C_OK) return secs;
        const all = ((res.data && res.data.rows) || [])
            .filter((r: any) => String(r.org_name || "").trim() || String(r.hospital_no || "").trim())
            .map((r: any) => ({ org_name: String(r.org_name || "").trim(), hospital_no: String(r.hospital_no || "").trim() }));
        if (!all.length) return secs;
        if (!cases || !cases.order || !cases.order.length) return secs;
        const byNo = new Map<string, { org_name: string; hospital_no: string }>();
        all.forEach((r: { org_name: string; hospital_no: string }) => {
            const key = String(r.hospital_no || "").trim().toUpperCase();
            if (key && !byNo.has(key)) byNo.set(key, r);
        });
        const rows = (cases.order as string[]).map((no) => byNo.get(no)).filter(Boolean) as Array<{ org_name: string; hospital_no: string }>;
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        return ensureCollectors(productId, members).then((collectors) =>
            applyDd002Hospitals(secs, rows, recvDatesFromTimeline(tlRows), collectors, cases.qty)
        );
    }).catch(() => secs);
};

const parseDd002ReturnRows = (secs: any[]) => {
    const list: { org: string; recv: string; qty: string; no: string }[] = [];
    const seen = new Set<string>();
    const txt = (s: any) => String(s ?? "").trim();
    const walk = (nodes: any[]) => {
        (nodes || []).forEach((n: any) => {
            if (!n) return;
            if (isMetaSection(n)) { walk(n.children || []); return; }
            (n.tables || []).forEach((tb: any[]) => {
                if (!Array.isArray(tb) || list.length) return;
                let headerIdx = -1;
                let iOrg = -1;
                let iRecv = -1;
                let iRet = -1;
                let iAct = -1;
                let iNo = -1;
                tb.forEach((row, ri) => {
                    if (!Array.isArray(row) || headerIdx >= 0) return;
                    const cells = row.map((c) => txt(c));
                    if (!cells.includes("数据来源") || !cells.includes("医院编号")) return;
                    headerIdx = ri;
                    iOrg = cells.indexOf("数据来源");
                    iRecv = cells.indexOf("数据接收时间");
                    iRet = cells.indexOf("回传数据量");
                    iAct = cells.indexOf("实际接收量");
                    iNo = cells.indexOf("医院编号");
                });
                if (headerIdx < 0) return;
                for (let r = headerIdx + 1; r < tb.length; r++) {
                    const row = tb[r] || [];
                    if (isSignRow(row)) break;
                    const org = txt(row[iOrg]);
                    const key = org.replace(/\s+/g, "");
                    if (!key || key === "无") continue;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const qty = txt(row[iRet]) || txt(row[iAct]);
                    list.push({ org, recv: txt(row[iRecv]), qty, no: iNo >= 0 ? txt(row[iNo]) : "" });
                }
            });
            walk(n.children || []);
        });
    };
    walk(secs);
    return list;
};

const mergeDd003ProductName = (tb: any[][], spans: ReturnType<typeof computeRecordSpans> | null, headerIdx: number) => {
    if (!spans || headerIdx < 0 || !Array.isArray(tb)) return spans;
    const txt = (s: any) => String(s ?? "").trim();
    const head = tb[headerIdx] || [];
    const unitI = head.findIndex((c: any) => /采集单位/.test(txt(c)));
    const staffI = head.findIndex((c: any) => /清洗人员/.test(txt(c)));
    const projI = head.findIndex((c: any) => /所属项目/.test(txt(c)));
    if (unitI < 0 || staffI < 0) return spans;
    const sub = tb[headerIdx + 1] || [];
    const hasSub = Array.isArray(sub) && sub.some((c: any) => /数据量|检查方式/.test(txt(c)));
    const dataStart = headerIdx + (hasSub ? 2 : 1);
    const row = tb[dataStart] || [];
    if (!txt(row[projI >= 0 ? projI : 0]) || txt(row[unitI])) return spans;
    const startC = projI >= 0 ? projI : 0;
    const want = staffI - startC + 1;
    if (want < 2 || !spans[dataStart]?.[startC] || spans[dataStart][startC].skip) return spans;
    const sp = spans[dataStart][startC];
    const oldCs = sp.colSpan || 1;
    if (oldCs > want) {
        for (let c = startC + want; c < startC + oldCs; c++) {
            if (spans[dataStart][c]) {
                spans[dataStart][c].skip = false;
                spans[dataStart][c].colSpan = 1;
            }
        }
        sp.colSpan = want;
    } else if (oldCs < want) {
        for (let c = startC + oldCs; c < startC + want; c++) {
            if (!txt(row[c]) && spans[dataStart][c] && !spans[dataStart][c].skip) {
                spans[dataStart][c].skip = true;
                sp.colSpan += 1;
            } else break;
        }
    }
    return spans;
};

const applyDd003FromReturn = (nodes: any[], src: { org: string; recv: string; qty: string }[], cleaners: string[] = [], productName = "") => {
    const txt = (s: any) => String(s ?? "").trim();
    const norm = (s: any) => txt(s).replace(/\s+/g, "");
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        let headerIdx = -1;
        let iUnit = -1;
        let iDate = -1;
        let iProj = -1;
        let iStaff = -1;
        let iQty = -1;
        let iWay = -1;
        let iDev = -1;
        let iProto = -1;
        let iScene = -1;
        let iConc = -1;
        let iSign = -1;
        tb.forEach((row, ri) => {
            if (!Array.isArray(row) || headerIdx >= 0) return;
            const cells = row.map((c) => txt(c));
            const unit = cells.findIndex((c) => /采集单位/.test(c));
            const date = cells.findIndex((c) => /清洗日期/.test(c));
            if (unit < 0 || date < 0) return;
            headerIdx = ri;
            iUnit = unit;
            iDate = date;
            iProj = cells.findIndex((c) => /所属项目/.test(c));
            iStaff = cells.findIndex((c) => /清洗人员/.test(c));
        });
        if (headerIdx < 0 || iUnit < 0) return tb;
        const sub = tb[headerIdx + 1] || [];
        const hasSub = Array.isArray(sub) && sub.some((c) => /数据量|检查方式/.test(txt(c)));
        const headOf = (re: RegExp) => {
            if (hasSub) {
                const i = sub.findIndex((c: any) => re.test(txt(c)));
                if (i >= 0) return i;
            }
            return (tb[headerIdx] || []).findIndex((c: any) => re.test(txt(c)));
        };
        if (hasSub) {
            iQty = sub.findIndex((c) => /^数据量$/.test(txt(c)));
            iWay = sub.findIndex((c) => /检查方式/.test(txt(c)));
        } else {
            iQty = (tb[headerIdx] || []).findIndex((c: any) => /^数据量$/.test(txt(c)));
        }
        iDev = headOf(/采集设备/);
        iProto = headOf(/采集协议/);
        iScene = headOf(/数据来源场景/);
        iConc = headOf(/评估结论/);
        iSign = headOf(/评估人员签字/);
        if (hasSub && iProj >= 0 && txt(sub[iProj]) && iWay >= 0 && txt(sub[iWay]) && !txt(sub[iUnit])) {
            const cleared = [...sub];
            cleared[iProj] = "";
            tb = tb.map((row, ri) => (ri === headerIdx + 1 ? cleared : row));
        }
        const dataStart = headerIdx + (hasSub ? 2 : 1);
        const isBannerRow = (row: any[]) => Array.isArray(row) && !isSignRow(row) && !txt(row[iUnit]) && txt(iProj >= 0 ? row[iProj] : row[0]);
        const makeBanner = (name: string) => {
            const next = new Array(cols).fill("");
            next[iProj >= 0 ? iProj : 0] = name;
            return next;
        };
        const bannerName = productName
            || txt((tb.slice(dataStart, tb.length).find((row) => isBannerRow(row)) || [])[iProj >= 0 ? iProj : 0]);
        let footerStart = tb.length;
        while (footerStart > dataStart && rowAllEmpty(tb[footerStart - 1], cols)) footerStart -= 1;
        while (footerStart > dataStart) {
            const row = tb[footerStart - 1] || [];
            const blob = (row || []).map((c: any) => txt(c)).join("");
            if (/文件编号|QR-RD-019/.test(blob) && onlyFirstRow(row, cols)) {
                footerStart -= 1;
                continue;
            }
            break;
        }
        const oldData = tb.slice(dataStart, footerStart).filter((row) => Array.isArray(row) && txt(row[iUnit]));
        const first = oldData[0];
        const hasCleaners = cleaners.length > 0;
        const along = [iProj, iStaff, iWay, iDev, iProto, iScene, iConc, iSign]
            .filter((i) => i >= 0 && !(hasCleaners && i === iStaff));
        const complete = (row: any[]) => [iDev, iProto, iConc].some((i) => i >= 0 && txt(row[i]));
        let tpl: any[] | undefined;
        oldData.forEach((row) => { if (complete(row)) tpl = row; });
        if (!tpl) tpl = first;
        const fillAlong = (next: any[], onlyEmpty: boolean) => {
            const srcRow = tpl;
            if (!srcRow) return;
            along.forEach((i) => {
                if (onlyEmpty && txt(next[i])) return;
                next[i] = txt(srcRow[i]);
            });
        };
        const withBanner = (hospitals: any[]) => {
            const banner = bannerName ? [makeBanner(bannerName)] : [];
            return [...tb.slice(0, dataStart), ...banner, ...hospitals, ...tb.slice(footerStart)];
        };
        const fixProj = (next: any[]) => {
            if (iProj < 0 || !productName || txt(next[iProj]) !== productName) return;
            const fromHosp = oldData.map((r) => txt(r[iProj])).find((s) => s && s !== productName);
            if (fromHosp) next[iProj] = fromHosp;
        };
        // 无回传记录：只按参与人员覆盖「脱敏检查、清洗人员」列，不重建医院行。
        if (!src.length) {
            const body = tb.slice(dataStart, footerStart).filter((row) => Array.isArray(row) && !isBannerRow(row));
            let ptr = 0;
            const hospitals = body.map((row) => {
                const next = [...row];
                if (iStaff >= 0 && hasCleaners && txt(next[iUnit])) {
                    next[iStaff] = cleaners[ptr % cleaners.length];
                    ptr += 1;
                }
                return next;
            });
            if (!bannerName && !hasCleaners) return tb;
            return withBanner(hospitals);
        }
        const unused = src.slice();
        const pick = (name: string) => {
            const n = norm(name);
            let i = unused.findIndex((x) => norm(x.org) === n);
            if (i < 0) i = unused.findIndex((x) => n.indexOf(norm(x.org)) >= 0 || norm(x.org).indexOf(n) >= 0);
            return i >= 0 ? unused.splice(i, 1)[0] : null;
        };
        let staffPtr = 0;
        const putCleaner = (next: any[]) => {
            if (iStaff >= 0 && hasCleaners) next[iStaff] = cleaners[staffPtr % cleaners.length];
        };
        const newData: any[] = [];
        oldData.forEach((row) => {
            const hit = pick(txt(row[iUnit]));
            if (!hit) return;
            const next = [...row];
            while (next.length < cols) next.push("");
            next[iUnit] = hit.org;
            if (iDate >= 0) next[iDate] = hit.recv;
            if (iQty >= 0) next[iQty] = hit.qty;
            putCleaner(next);
            fillAlong(next, true);
            fixProj(next);
            newData.push(next);
            if (hasCleaners) staffPtr += 1;
        });
        unused.forEach((hit) => {
            const next = new Array(cols).fill("");
            next[iUnit] = hit.org;
            if (iDate >= 0) next[iDate] = hit.recv;
            if (iQty >= 0) next[iQty] = hit.qty;
            putCleaner(next);
            fillAlong(next, false);
            fixProj(next);
            newData.push(next);
            if (hasCleaners) staffPtr += 1;
        });
        return withBanner(newData);
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const fillDd003FromReturn = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        latestDataDoc(productId, "dd_002"),
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
        ApiProduct.get_product({ id: productId }).catch(() => null),
    ]).then(([doc, mb, pr]: any[]) => {
        const src = parseDd002ReturnRows((doc && doc.content && doc.content.sections) || []);
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        const cleaners = namesByRole(members, "脱敏+清洗人员");
        const productName = pr && pr.code === ApiProduct.C_OK ? String((pr.data || {}).name || "").trim() : "";
        if (!src.length && !cleaners.length && !productName) return secs;
        return applyDd003FromReturn(secs, src, cleaners, productName);
    }).catch(() => secs);
};

const blankRecordSpans = (grid: any[][]) => {
    const rows = grid || [];
    const R = rows.length;
    const C = rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    return Array.from({ length: R }, () => Array.from({ length: C }, () => ({ skip: false, colSpan: 1, rowSpan: 1 })));
};

const spanRowCols = (spans: ReturnType<typeof computeRecordSpans> | null, r: number, start: number, end: number) => {
    if (!spans?.[r]?.[start] || end < start) return spans;
    const sp = spans[r][start];
    if (sp.skip) return spans;
    const want = end - start + 1;
    const oldCs = sp.colSpan || 1;
    if (oldCs > want) {
        for (let c = start + want; c < start + oldCs; c++) {
            if (spans[r][c]) {
                spans[r][c].skip = false;
                spans[r][c].colSpan = 1;
            }
        }
        sp.colSpan = want;
    } else if (oldCs < want) {
        for (let c = start + oldCs; c < start + want; c++) {
            if (spans[r][c] && !spans[r][c].skip) {
                spans[r][c].skip = true;
                sp.colSpan += 1;
            } else break;
        }
    }
    for (let c = start + 1; c <= end; c++) {
        if (spans[r][c]) spans[r][c].skip = true;
    }
    sp.colSpan = want;
    return spans;
};

const mergeDd004ReqAct = (tb: any[][], spans: ReturnType<typeof computeRecordSpans> | null) => {
    if (!Array.isArray(tb) || !spans) return spans;
    const txt = (s: any) => String(s ?? "").trim();
    let headerIdx = -1;
    let iReq = -1;
    let iAct = -1;
    let iOk = -1;
    tb.forEach((row, ri) => {
        if (headerIdx >= 0 || !Array.isArray(row)) return;
        const cells = row.map((c) => txt(c));
        if (!cells.includes("文档需求") || !cells.includes("实际情况")) return;
        headerIdx = ri;
        iReq = cells.indexOf("文档需求");
        iAct = cells.indexOf("实际情况");
        iOk = cells.indexOf("是否符合需求");
    });
    if (headerIdx < 0 || iReq < 0 || iAct < 0) return spans;
    const endReq = iAct - 1;
    const endAct = iOk > iAct ? iOk - 1 : iAct;
    const last = iOk >= 0 ? iOk : endAct;
    for (let r = headerIdx; r < tb.length; r++) {
        if (!Array.isArray(tb[r]) || isSignRow(tb[r])) break;
        if (txt(tb[r][0]) === "结论") {
            if (last > iReq) spanRowCols(spans, r, iReq, last);
            continue;
        }
        if (endReq > iReq) spanRowCols(spans, r, iReq, endReq);
        if (endAct > iAct) spanRowCols(spans, r, iAct, endAct);
    }
    return spans;
};

const mergeDd010ProductName = (tb: any[][], spans: ReturnType<typeof computeRecordSpans> | null, firstBody: number) => {
    if (!Array.isArray(tb) || firstBody < 0) return spans;
    const txt = (s: any) => String(s ?? "").trim();
    const head = tb[firstBody] || [];
    const hospI = head.findIndex((c: any) => /数据所属医院/.test(txt(c)));
    const setI = head.findIndex((c: any) => txt(c) === "数据集");
    const projI = head.findIndex((c: any) => /数据所属项目/.test(txt(c)));
    const personI = head.findIndex((c: any) => /上传人员/.test(txt(c)));
    if (projI < 0 || (hospI < 0 && setI < 0)) return spans;
    const dataStart = firstBody + 1;
    const row = tb[dataStart] || [];
    if (!txt(row[projI])) return spans;
    if (hospI >= 0 && txt(row[hospI])) return spans;
    if (setI >= 0 && txt(row[setI])) return spans;
    const next = spans || blankRecordSpans(tb);
    const end = personI >= 0 ? personI : Math.max(projI, (row || []).length - 1);
    return spanRowCols(next, dataStart, projI, end);
};

const mergeDd012Project = (tb: any[][], spans: ReturnType<typeof computeRecordSpans> | null) => {
    if (!Array.isArray(tb)) return spans;
    const txt = (s: any) => String(s ?? "").trim();
    const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
    const next = spans || blankRecordSpans(tb);
    tb.forEach((row, r) => {
        if (!Array.isArray(row)) return;
        if (txt(row[0]) !== "所属项目") return;
        spanRowCols(next, r, 1, cols - 1);
        if (!txt(row[1]) && txt(row[0])) spanRowCols(next, r, 0, cols - 1);
    });
    const banner = tb.findIndex((row, r) => {
        if (r < 2 || !Array.isArray(row) || !onlyFirstRow(row, cols)) return false;
        const a = txt(row[0]);
        return a && !looksLikeFileNo(a) && a !== "所属项目" && a !== "时间";
    });
    if (banner >= 0) spanRowCols(next, banner, 0, cols - 1);
    let headerIdx = -1;
    let iTime = -1;
    const vCols: number[] = [];
    tb.forEach((row, ri) => {
        if (headerIdx >= 0 || !Array.isArray(row)) return;
        const cells = row.map((c) => txt(c));
        if (!cells.includes("批次") || !cells.includes("数据量")) return;
        headerIdx = ri;
        iTime = cells.indexOf("时间");
        const iQty = cells.indexOf("数据量");
        if (iQty >= 0) {
            for (let r = headerIdx + 1; r < tb.length; r++) {
                const body = tb[r] || [];
                if (!Array.isArray(body) || isSignRow(body)) break;
                if (!txt(body[iQty]) || !next[r]?.[iQty] || next[r][iQty].skip) continue;
                const sp = next[r][iQty];
                const oldCs = sp.colSpan || 1;
                if (oldCs <= 1) continue;
                for (let c = iQty + 1; c < iQty + oldCs; c++) {
                    if (next[r][c]) {
                        next[r][c].skip = false;
                        next[r][c].colSpan = 1;
                        next[r][c].rowSpan = 1;
                    }
                }
                sp.colSpan = 1;
            }
        }
        ["时间", "查重结果", "检查人", "检查时间", "复核人", "复核时间"].forEach((name) => {
            const i = cells.indexOf(name);
            if (i >= 0) vCols.push(i);
        });
    });
    if (headerIdx < 0) return next;
    let r = headerIdx + 1;
    while (r < tb.length) {
        const row = tb[r] || [];
        if (!Array.isArray(row) || isSignRow(row)) break;
        let r2 = r;
        if (iTime >= 0 && txt(row[iTime])) {
            while (r2 + 1 < tb.length) {
                const below = tb[r2 + 1] || [];
                if (!Array.isArray(below) || isSignRow(below) || txt(below[iTime])) break;
                r2 += 1;
            }
        }
        if (r2 > r) {
            vCols.forEach((c) => {
                if (!next[r]?.[c] || next[r][c].skip) return;
                next[r][c].rowSpan = r2 - r + 1;
                for (let k = r + 1; k <= r2; k++) {
                    if (next[k]?.[c]) next[k][c].skip = true;
                }
            });
        }
        r = r2 + 1;
    }
    return next;
};

const rewriteUploadPath = (path: string, oldNo: string, newNo: string) => {
    const p = String(path || "").trim();
    const n = String(newNo || "").trim();
    if (!p || !n) return p;
    const o = String(oldNo || "").trim();
    if (o && p.includes(o)) return p.split(o).join(n);
    return p.replace(/\/[A-Za-z0-9]+\/?$/, `/${n}`);
};

const applyDd010FromReturn = (
    nodes: any[],
    src: { org: string; recv: string; qty: string; no: string }[],
    productName = "",
    annQty = "",
    extra: { rawDates?: string[]; baseDates?: string[]; annDates?: string[]; cleaners?: string[] } = {},
) => {
    const rawDates = extra.rawDates || [];
    const baseDates = extra.baseDates || [];
    const annDates = extra.annDates || [];
    const cleaners = extra.cleaners || [];
    const txt = (s: any) => String(s ?? "").trim();
    const norm = (s: any) => txt(s).replace(/\s+/g, "");
    const fixTable = (tb: any[], title = "") => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        let headerIdx = -1;
        let iProj = -1;
        let iHosp = -1;
        let iNo = -1;
        let iDate = -1;
        let iQty = -1;
        let iPath = -1;
        let iPerson = -1;
        let iSet = -1;
        tb.forEach((row, ri) => {
            if (!Array.isArray(row) || headerIdx >= 0) return;
            const cells = row.map((c) => txt(c));
            if (cells.includes("数据所属医院") && cells.includes("医院编号")) {
                headerIdx = ri;
                iProj = cells.findIndex((c) => /数据所属项目/.test(c));
                iHosp = cells.indexOf("数据所属医院");
                iNo = cells.indexOf("医院编号");
                iDate = cells.indexOf("上传日期");
                iQty = cells.findIndex((c) => /上传数据量/.test(c));
                iPath = cells.indexOf("存储路径");
                iPerson = cells.indexOf("上传人员");
            } else if (cells.includes("数据集") && cells.includes("数据所属项目")) {
                headerIdx = ri;
                iProj = cells.indexOf("数据所属项目");
                iSet = cells.indexOf("数据集");
                iQty = cells.findIndex((c) => /上传数据量/.test(c));
                iDate = cells.indexOf("上传日期");
                iPerson = cells.indexOf("上传人员");
            }
        });
        if (headerIdx < 0) return tb;
        const kind = String(title || "").replace(/\s/g, "");
        const dates = kind.includes("标注") || iSet >= 0
            ? annDates
            : kind.includes("基础")
                ? baseDates
                : rawDates;
        const putDatePerson = (row: any[], i: number, fallbackDate = "") => {
            const d = dates.length ? dates[i % dates.length] : fallbackDate;
            if (iDate >= 0 && d) {
                while (row.length <= iDate) row.push("");
                row[iDate] = d;
            }
            if (iPerson >= 0 && cleaners.length) {
                while (row.length <= iPerson) row.push("");
                row[iPerson] = cleaners[i % cleaners.length];
            }
        };
        let footerStart = tb.length;
        while (footerStart > headerIdx + 1 && rowAllEmpty(tb[footerStart - 1], cols)) footerStart -= 1;
        while (footerStart > headerIdx + 1) {
            const row = tb[footerStart - 1] || [];
            if (isSignRow(row) || (row || []).some((c: any) => /签字/.test(txt(c)))) {
                footerStart -= 1;
                continue;
            }
            break;
        }
        const isBanner = (row: any[]) => Array.isArray(row) && iProj >= 0 && txt(row[iProj]) && (iHosp < 0 || !txt(row[iHosp])) && (iSet < 0 || !txt(row[iSet]));
        const makeBanner = (name: string) => {
            const next = new Array(cols).fill("");
            next[iProj >= 0 ? iProj : 0] = name;
            return next;
        };
        const withBanner = (body: any[], name: string) => {
            const banner = name ? [makeBanner(name)] : [];
            return [...tb.slice(0, headerIdx + 1), ...banner, ...body, ...tb.slice(footerStart)];
        };
        if (iSet >= 0) {
            const kept = tb.slice(headerIdx + 1, footerStart).filter((row) => Array.isArray(row) && txt(row[iSet])).map((row, i) => {
                const next = [...row];
                if (iProj >= 0 && productName && txt(next[iProj]) === productName) next[iProj] = "肺栓塞";
                if (annQty && iQty >= 0) {
                    while (next.length <= iQty) next.push("");
                    next[iQty] = annQty;
                }
                putDatePerson(next, i);
                return next;
            });
            const bannerName = productName
                || txt((tb.slice(headerIdx + 1, footerStart).find((row) => isBanner(row)) || [])[iProj >= 0 ? iProj : 0]);
            if (!bannerName) return [...tb.slice(0, headerIdx + 1), ...kept, ...tb.slice(footerStart)];
            return withBanner(kept, bannerName);
        }
        const oldData = tb.slice(headerIdx + 1, footerStart).filter((row) => Array.isArray(row) && (txt(row[iHosp]) || txt(row[iNo])));
        const bannerName = productName
            || txt((tb.slice(headerIdx + 1, footerStart).find((row) => isBanner(row)) || [])[iProj >= 0 ? iProj : 0]);
        const withHospitals = (hospitals: any[]) => withBanner(hospitals, bannerName);
        if (!src.length) {
            const hospitals = oldData.map((row, i) => {
                const next = [...row];
                if (iProj >= 0 && productName && txt(next[iProj]) === productName) next[iProj] = "肺栓塞";
                putDatePerson(next, i);
                return next;
            });
            if (!bannerName) return [...tb.slice(0, headerIdx + 1), ...hospitals, ...tb.slice(footerStart)];
            return withHospitals(hospitals);
        }
        const unused = src.slice();
        const pick = (name: string, no: string) => {
            const n = norm(name);
            const k = String(no || "").trim().toUpperCase();
            let i = k ? unused.findIndex((x) => String(x.no || "").trim().toUpperCase() === k) : -1;
            if (i < 0) i = unused.findIndex((x) => norm(x.org) === n);
            if (i < 0) i = unused.findIndex((x) => n && (n.indexOf(norm(x.org)) >= 0 || norm(x.org).indexOf(n) >= 0));
            return i >= 0 ? unused.splice(i, 1)[0] : null;
        };
        const tpl = oldData.find((row) => txt(row[iPath]) || txt(row[iPerson])) || oldData[0];
        const projVal = oldData.map((r) => txt(r[iProj])).find((s) => s && s !== productName) || "肺栓塞";
        const newData: any[] = [];
        oldData.forEach((row) => {
            const hit = pick(txt(row[iHosp]), txt(row[iNo]));
            if (!hit) return;
            const next = [...row];
            while (next.length < cols) next.push("");
            if (iProj >= 0) next[iProj] = projVal;
            next[iHosp] = hit.org;
            if (iNo >= 0) next[iNo] = hit.no;
            if (iQty >= 0) next[iQty] = hit.qty;
            if (iPath >= 0) next[iPath] = rewriteUploadPath(txt(row[iPath]) || txt(tpl?.[iPath]), txt(row[iNo]), hit.no);
            putDatePerson(next, newData.length, hit.recv);
            newData.push(next);
        });
        unused.forEach((hit) => {
            const next = new Array(cols).fill("");
            if (iProj >= 0) next[iProj] = projVal;
            next[iHosp] = hit.org;
            if (iNo >= 0) next[iNo] = hit.no;
            if (iQty >= 0) next[iQty] = hit.qty;
            if (iPath >= 0) next[iPath] = rewriteUploadPath(txt(tpl?.[iPath]), txt(tpl?.[iNo]), hit.no);
            putDatePerson(next, newData.length, hit.recv);
            newData.push(next);
        });
        return withHospitals(newData);
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb, n.title) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const parseDd015TotalQty = (content: any): string => {
    const hit = caseRowsFromContent(content);
    if (hit && hit.rows && hit.rows.length) return String(hit.rows.length);
    let total = "";
    walkDocSections((content && content.sections) || [], (n) => {
        (n.tables || []).forEach((tb: any[]) => {
            (tb || []).forEach((row: any[]) => {
                if (!Array.isArray(row) || total) return;
                const cells = row.map((c) => String(c ?? "").trim());
                const i = cells.findIndex((c) => c.replace(/\s/g, "").includes("数据总量"));
                if (i < 0) return;
                const m = String(cells[i + 1] || "").match(/\d+/);
                if (m) total = m[0];
            });
        });
    });
    return total;
};

const fillDd010FromReturn = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        latestDataDoc(productId, "dd_002"),
        latestDataDoc(productId, "dd_015_03"),
        ApiProduct.get_product({ id: productId }).catch(() => null),
        ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
    ]).then(([doc, dd01503, pr, tl, mb]: any[]) => {
        const src = parseDd002ReturnRows((doc && doc.content && doc.content.sections) || []);
        const productName = pr && pr.code === ApiProduct.C_OK ? String((pr.data || {}).name || "").trim() : "";
        const cached = readStatsCache(productId, "ann");
        const annQty = (cached && cached.rows && cached.rows.length)
            ? String(cached.rows.length)
            : parseDd015TotalQty(dd01503 && dd01503.content);
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        const extra = {
            rawDates: datesFromTimeline(tlRows, "原始数据库上传记录"),
            baseDates: datesFromTimeline(tlRows, "基础数据库上传记录"),
            annDates: datesFromTimeline(tlRows, "标注数据库上传记录"),
            cleaners: namesByRole(members, "脱敏+清洗人员"),
        };
        if (!src.length && !productName && !annQty && !extra.rawDates.length && !extra.baseDates.length
            && !extra.annDates.length && !extra.cleaners.length) return secs;
        return applyDd010FromReturn(secs, src, productName, annQty, extra);
    }).catch(() => secs);
};

const applyDd012Project = (
    nodes: any[],
    productName = "",
    counts: Record<string, string> = {},
    extra: { dates?: string[]; checkers?: string[]; reviewers?: string[] } = {},
) => {
    const txt = (s: any) => String(s ?? "").trim();
    const dates = extra.dates || [];
    const checkers = extra.checkers || [];
    const reviewers = extra.reviewers || [];
    const put = (row: any[], i: number, v: string) => {
        if (i < 0 || !v) return;
        while (row.length <= i) row.push("");
        row[i] = v;
    };
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        const idx = tb.findIndex((row) => Array.isArray(row) && txt(row[0]) === "所属项目");
        let nextTb = tb;
        if (idx >= 0) {
            const row = [...tb[idx]];
            while (row.length < cols) row.push("");
            const cur = txt(row[1]);
            if (productName && cur === productName) row[1] = "肺栓塞";
            else if (!cur) row[1] = "肺栓塞";
            const before = tb.slice(0, idx).filter((r) => !(Array.isArray(r) && onlyFirstRow(r, cols) && txt(r[0]) === productName));
            const banner = productName ? [(() => { const n = new Array(cols).fill(""); n[0] = productName; return n; })()] : [];
            nextTb = [...before, ...banner, row, ...tb.slice(idx + 1)];
        }
        let iBatch = -1;
        let iQty = -1;
        if (counts && Object.keys(counts).length) {
            nextTb = nextTb.map((row) => {
                if (!Array.isArray(row)) return row;
                const cells = row.map((c) => txt(c));
                if (iBatch < 0 && cells.includes("批次") && cells.includes("数据量")) {
                    iBatch = cells.indexOf("批次");
                    iQty = cells.indexOf("数据量");
                    return row;
                }
                if (iBatch < 0) return row;
                const name = txt(row[iBatch]);
                const qty = counts[name];
                if (!name || !qty) return row;
                const next = [...row];
                while (next.length <= iQty) next.push("");
                next[iQty] = qty;
                return next;
            });
        }
        let headerIdx = -1;
        let iTime = -1;
        let iChecker = -1;
        let iCheckTime = -1;
        let iReviewer = -1;
        let iReviewTime = -1;
        nextTb.forEach((row, ri) => {
            if (headerIdx >= 0 || !Array.isArray(row)) return;
            const cells = row.map((c) => txt(c));
            if (!cells.includes("批次") || !cells.includes("数据量")) return;
            headerIdx = ri;
            iTime = cells.indexOf("时间");
            iChecker = cells.indexOf("检查人");
            iCheckTime = cells.indexOf("检查时间");
            iReviewer = cells.indexOf("复核人");
            iReviewTime = cells.indexOf("复核时间");
        });
        if (headerIdx < 0) return nextTb;
        let group = -1;
        return nextTb.map((row, ri) => {
            if (ri <= headerIdx || !Array.isArray(row) || isSignRow(row)) return row;
            const start = group < 0 || (iTime >= 0 && txt(row[iTime]));
            if (!start) return row;
            group += 1;
            const next = [...row];
            const date = dates.length ? dates[group % dates.length] : (iTime >= 0 ? txt(next[iTime]) : "");
            if (dates.length) put(next, iTime, date);
            put(next, iCheckTime, date);
            put(next, iReviewTime, date);
            if (checkers.length) put(next, iChecker, checkers[group % checkers.length]);
            if (reviewers.length) put(next, iReviewer, reviewers[group % reviewers.length]);
            return next;
        });
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const fillDd012FromProduct = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        ApiProduct.get_product({ id: productId }).catch(() => null),
        latestDataDoc(productId, "dd_010"),
        ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
    ]).then(([pr, dd010, tl, mb]: any[]) => {
        const productName = pr && pr.code === ApiProduct.C_OK ? String((pr.data || {}).name || "").trim() : "";
        const counts = parseDd010Counts(dd010 && dd010.content).counts;
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        let dates = datesFromTimeline(tlRows, "查重记录");
        if (!dates.length) dates = datesFromTimeline(tlRows, "训练集测试集查重");
        if (!dates.length) dates = datesFromTimeline(tlRows, "查重");
        const checkers = namesByRole(members, "脱敏+清洗人员");
        const reviewers = namesByRole(members, "模型负责人");
        const reviewerNames = reviewers.length ? reviewers : namesByRole(members, "模型部负责人");
        if (!productName && !Object.keys(counts).length && !dates.length && !checkers.length && !reviewerNames.length) return secs;
        return applyDd012Project(secs, productName, counts, { dates, checkers, reviewers: reviewerNames });
    }).catch(() => secs);
};

const maintDatesFromTimeline = (tlRows: any[]) => {
    const seen: Record<string, true> = {};
    const out: Array<{ k: number; s: string }> = [];
    (tlRows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const text = String((r.cells || {})["数据部"] || "");
        if (!text.includes("数据库维护")) return;
        const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
        const y = num(r.year);
        const m = num(r.month);
        const d = num(r.day);
        if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1) return;
        const k = y * 10000 + m * 100 + d;
        const s = `${y}.${m}.${d}`;
        if (seen[s]) return;
        seen[s] = true;
        out.push({ k, s });
    });
    return out.sort((a, b) => a.k - b.k).map((x) => x.s);
};

const fillMaintCheckDate = (tb: any[], date: string) => {
    if (!Array.isArray(tb)) return tb;
    return tb.map((row) => {
        if (!Array.isArray(row)) return row;
        const i = row.findIndex((c: any) => String(c ?? "").trim() === "检查日期");
        if (i < 0) return row;
        const next = [...row];
        while (next.length <= i + 1) next.push("");
        next[i + 1] = date;
        return next;
    });
};

const secHasCheckDate = (n: any) =>
    (n.tables || []).some((tb: any[]) => Array.isArray(tb) && tb.some((row: any[]) =>
        Array.isArray(row) && row.some((c: any) => String(c ?? "").trim() === "检查日期")
    ));

const applyDd014Maint = (nodes: any[], dates: string[]) => {
    if (!dates.length) return nodes;
    const list = nodes || [];
    const records = list.filter((n: any) => !isMetaSection(n) && secHasCheckDate(n));
    if (!records.length) return list;
    const tpl = records[records.length - 1];
    const built = dates.map((date, idx) => {
        const src = records[idx] || tpl;
        return {
            ...src,
            _key: genKey(),
            tables: (src.tables || []).map((tb: any[]) => fillMaintCheckDate(
                JSON.parse(JSON.stringify(Array.isArray(tb) ? tb : [])),
                date,
            )),
            children: (src.children || []).map((c: any) => ({ ...c })),
        };
    });
    let used = false;
    const out: any[] = [];
    list.forEach((n: any) => {
        if (isMetaSection(n) || !secHasCheckDate(n)) {
            out.push(n);
            return;
        }
        if (!used) {
            out.push(...built);
            used = true;
        }
    });
    return out;
};

const fillDd014FromTimeline = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return ApiTimeline.list_timeline({ prod_id: productId }).then((tl: any) => {
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const dates = maintDatesFromTimeline(tlRows);
        if (!dates.length) return secs;
        return applyDd014Maint(secs, dates);
    }).catch(() => secs);
};

const DD015_KIND: Record<string, StatsKind> = {
    dd_015_01: "raw",
    dd_015_02: "base",
    dd_015_03: "ann",
};

const fileNoFromSections = (nodes: any[], fallback = "") => {
    let hit = fallback;
    walkDocSections(nodes, (n) => {
        (n.tables || []).forEach((tb: any[]) => {
            (tb || []).forEach((row: any[]) => {
                if (!Array.isArray(row)) return;
                const a = String(row[0] ?? "").trim();
                if (looksLikeFileNo(a)) hit = a;
            });
        });
    });
    return hit;
};

const fillDd015Stats = (productId: number, docType: string, secs: any[], fileNo = ""): Promise<any[]> => {
    const kind = DD015_KIND[docType];
    if (!kind || !productId) return Promise.resolve(secs);
    const local = caseRowsFromContent({ sections: secs }) || readStatsCache(productId, kind);
    const siblingTypes = kind === "base"
        ? ["dd_015_01", "dd_015_03", "dd_015_02"]
        : kind === "raw"
            ? ["dd_015_01", "dd_015_02", "dd_015_03"]
            : ["dd_015_03", "dd_015_01", "dd_015_02"];
    const pickCached = (): Promise<any> => {
        if (local && local.rows && local.rows.length) return Promise.resolve(local);
        const next = (i: number): Promise<any> => {
            if (i >= siblingTypes.length) {
                const cache = readStatsCache(productId, "raw") || readStatsCache(productId, "base") || readStatsCache(productId, "ann");
                return Promise.resolve(cache && cache.rows && cache.rows.length ? cache : null);
            }
            return latestDataDoc(productId, siblingTypes[i]).then((doc: any) => {
                const hit = caseRowsFromContent(doc && doc.content);
                if (hit && hit.rows && hit.rows.length) return hit;
                return next(i + 1);
            });
        };
        return next(0);
    };
    return Promise.all([
        pickCached(),
        ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
    ]).then(([cached, tl, mb]: any[]) => {
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
        const rows = (cached && cached.rows) || [];
        const auto = autoStatsExtra(kind, members, tlRows, {
            person: cached?.person,
            dataType: cached?.dataType,
            disease: cached?.disease,
        });
        const no = fileNoFromSections(secs, fileNo);
        if (rows.length) {
            const grid = buildStatsGrid(STATS_TITLES[kind], rows, { ...auto, fileNo: no });
            const fix = (n: any): any => {
                if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
                return attachCaseRows({ ...n, tables: [grid] }, {
                    rows,
                    person: auto.person || "",
                    dataType: auto.dataType || "",
                    disease: auto.disease || "",
                    source: cached?.source || "",
                });
            };
            return (secs || []).map(fix);
        }
        const txt = (s: any) => String(s ?? "").trim();
        const patch = (tb: any[]) => {
            if (!Array.isArray(tb)) return tb;
            return tb.map((row) => {
                if (!Array.isArray(row)) return row;
                const next = [...row];
                const iPerson = next.findIndex((c) => txt(c) === "统计人");
                if (iPerson >= 0 && auto.person) {
                    while (next.length <= iPerson + 1) next.push("");
                    next[iPerson + 1] = auto.person;
                }
                const iDate = next.findIndex((c) => txt(c) === "统计日期");
                if (iDate >= 0 && auto.date) {
                    while (next.length <= iDate + 1) next.push("");
                    next[iDate + 1] = auto.date;
                }
                return next;
            });
        };
        const fix = (n: any): any => {
            if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
            return {
                ...n,
                tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? patch(tb) : tb)),
                children: (n.children || []).map(fix),
            };
        };
        return (secs || []).map(fix);
    }).catch(() => secs);
};

const DD004_REQ_TEMPLATE: Record<string, string> = {
    检查方式: "胸部CTPA",
    数据来源: "尽可能来自多家（至少3家）临床机构",
    性别分布: "无限制，男女都有",
    年龄分布: "无限制；年龄分布在各个年龄段。",
    地域分布: "地域分布应尽量广泛；",
    采集设备: "应至少包含3家不同制造商的采集设备，如GE、西门子、飞利浦等",
    采集方式与协议: "CTPA",
    采集参数: "管电压大于等于70KVP",
    采集精度: "分辨率不低于512*512",
    数据量: "总计不少于7000例数据",
    问题描述: "无",
};

const shortDeviceName = (raw: string) => {
    const s = String(raw || "").trim();
    if (!s || s === "none") return "";
    const u = s.toUpperCase();
    if (/SIEMENS/.test(u)) return "西门子";
    if (/PHILIPS/.test(u)) return "飞利浦";
    if (/GENERAL ELECTRIC|\bGE\b/.test(u) || /^GE/.test(u)) return "GE";
    if (/TOSHIBA|CANON/.test(u)) return "东芝";
    if (/UNITED IMAGING|UIH|联影/.test(s)) return "联影";
    if (/NEUSOFT|东软/.test(s)) return "东软";
    if (/\bNMS\b/.test(u)) return "NMS";
    return s;
};

const loadCaseRowsForDoc = (productId: number): Promise<any[]> => {
    if (!productId) return Promise.resolve([]);
    const last = readLastStats();
    if (last && last.productId === productId && last.item.rows && last.item.rows.length) {
        return Promise.resolve(last.item.rows);
    }
    const cached = readStatsCache(productId, "raw") || readStatsCache(productId, "base") || readStatsCache(productId, "ann");
    if (cached && cached.rows && cached.rows.length) return Promise.resolve(cached.rows);
    const types = ["dd_015_01", "dd_015_02", "dd_015_03"];
    const next = (i: number): Promise<any[]> => {
        if (i >= types.length) return Promise.resolve([]);
        return latestDataDoc(productId, types[i]).then((doc: any) => {
            const hit = caseRowsFromContent(doc && doc.content);
            if (hit && hit.rows && hit.rows.length) return hit.rows;
            return next(i + 1);
        });
    };
    return next(0);
};

const summarizeDd004Actual = (hospitals: Array<{ no: string; region: string }>, cases: any[], qtySum: number) => {
    const txt = (r: any, ...keys: string[]) => {
        for (let i = 0; i < keys.length; i++) {
            const v = r?.[keys[i]];
            if (v != null && String(v).trim() && String(v).trim() !== "none") return String(v).trim();
        }
        return "";
    };
    const regions: string[] = [];
    const regionOrder = ["东区", "南区", "西区", "北区"];
    hospitals.forEach((h) => {
        const r = String(h.region || "").trim();
        if (r && regions.indexOf(r) < 0) regions.push(r);
    });
    regions.sort((a, b) => {
        const ia = regionOrder.indexOf(a);
        const ib = regionOrder.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    let male = 0;
    let female = 0;
    const ages: number[] = [];
    const kvps: number[] = [];
    const devices: string[] = [];
    (cases || []).forEach((r) => {
        const sex = txt(r, "SEX", "sex").toUpperCase();
        if (sex === "M" || sex === "MALE") male += 1;
        if (sex === "F" || sex === "FEMALE") female += 1;
        const age = parseFloat(txt(r, "AGE", "age"));
        if (!isNaN(age) && age > 0 && age < 130) ages.push(age);
        const kvp = parseFloat(txt(r, "KVP", "kvp"));
        if (!isNaN(kvp) && kvp > 0 && kvp < 1000) kvps.push(kvp);
        const dev = shortDeviceName(txt(r, "DEVICE", "device"));
        if (dev && devices.indexOf(dev) < 0) devices.push(dev);
    });
    const bins = [0, 0, 0, 0];
    ages.forEach((a) => {
        if (a <= 18) bins[0] += 1;
        else if (a <= 40) bins[1] += 1;
        else if (a <= 60) bins[2] += 1;
        else bins[3] += 1;
    });
    const binCount = bins.filter((n) => n > 0).length;
    const sexText = (!male && !female) ? ""
        : (!female ? "仅男性" : !male ? "仅女性" : male === female ? "男女都有" : male > female ? "男性多于女性" : "女性多于男性");
    const ageText = !ages.length ? ""
        : (binCount >= 2 ? "分布于各年龄段" : `分布于${Math.min(...ages)}岁至${Math.max(...ages)}岁`);
    const kvpMin = kvps.length ? Math.min(...kvps) : 0;
    const kvpMax = kvps.length ? Math.max(...kvps) : 0;
    const fmtKvp = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
    const paramText = !kvps.length ? ""
        : (kvpMin === kvpMax ? `管电压${fmtKvp(kvpMin)}KVP` : `管电压${fmtKvp(kvpMin)}～${fmtKvp(kvpMax)}KVP`);
    return {
        检查方式: "",
        数据来源: hospitals.length ? `来源于${hospitals.length}家医院` : "",
        性别分布: sexText,
        年龄分布: ageText,
        地域分布: regions.length ? `来源于${regions.join("、")}的医院` : "",
        采集设备: devices.length ? devices.join("、") : "",
        采集方式与协议: "",
        采集参数: paramText,
        采集精度: "",
        数据量: qtySum ? `总计约${qtySum}例` : "",
        kvpAllGe70: kvps.length ? kvps.every((v) => v >= 70) : null as boolean | null,
        deviceCount: devices.length,
        regionCount: regions.length,
        hasBothSex: !!(male && female),
        ageSpread: binCount >= 2,
        hospCount: hospitals.length,
        qtySum,
    };
};

const dd004Meet = (label: string, req: string, act: string, extra: ReturnType<typeof summarizeDd004Actual>) => {
    if (!act) return "";
    if (label === "数据来源") {
        const m = req.match(/至少(\d+)家/);
        const need = m ? parseInt(m[1], 10) : 3;
        return extra.hospCount >= need ? "是" : "否";
    }
    if (label === "采集设备") {
        const m = req.match(/至少(\d+)家/);
        const need = m ? parseInt(m[1], 10) : 3;
        return extra.deviceCount >= need ? "是" : "否";
    }
    if (label === "地域分布") return extra.regionCount >= 2 ? "是" : "否";
    if (label === "采集参数") return extra.kvpAllGe70 == null ? "" : extra.kvpAllGe70 ? "是" : "否";
    if (label === "数据量") {
        const m = req.match(/(\d+)例/);
        const need = m ? parseInt(m[1], 10) : 0;
        return need ? (extra.qtySum >= need ? "是" : "否") : "";
    }
    if (label === "性别分布") return extra.hasBothSex ? "是" : (act ? "否" : "");
    if (label === "年龄分布") return extra.ageSpread ? "是" : (act ? "否" : "");
    if (label === "检查方式" || label === "采集方式与协议") {
        if (/CTPA/i.test(req)) return /CTPA/i.test(act) ? "是" : "否";
    }
    return "";
};

const applyDd004Numbers = (nodes: any[], src: {
    act: ReturnType<typeof summarizeDd004Actual>;
    hasReturn: boolean;
}) => {
    const txt = (s: any) => String(s ?? "").trim();
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        let headerIdx = -1;
        let iLabel = -1;
        let iReq = -1;
        let iAct = -1;
        let iOk = -1;
        tb.forEach((row, ri) => {
            if (!Array.isArray(row) || headerIdx >= 0) return;
            const cells = row.map((c) => txt(c));
            if (!cells.includes("评估要点") || !cells.includes("文档需求") || !cells.includes("实际情况")) return;
            headerIdx = ri;
            iLabel = cells.indexOf("评估要点");
            iReq = cells.indexOf("文档需求");
            iAct = cells.indexOf("实际情况");
            iOk = cells.indexOf("是否符合需求");
        });
        if (headerIdx < 0 || iLabel < 0) return tb;
        let anyNo = false;
        const nextTb = tb.map((row, ri) => {
            if (!Array.isArray(row) || ri <= headerIdx) return row;
            const label = txt(row[iLabel]).replace(/[\uF000-\uF8FF]/g, "");
            if (label === "结论") {
                const next = [...row];
                if (iReq >= 0) {
                    next[iReq] = anyNo
                        ? "本次采集到的数据尚未完全符合数据采集需求。"
                        : "本次采集到的数据符合数据采集需求。";
                }
                return next;
            }
            if (isSignRow(row)) return row;
            const next = [...row];
            const reqVal = label === "数据量" && src.act.qtySum > 0
                ? `总计不少于${src.act.qtySum}例数据`
                : (DD004_REQ_TEMPLATE[label] || "");
            if (reqVal && iReq >= 0) next[iReq] = reqVal;
            if (label === "问题描述") return next;
            let actVal = src.act[label as keyof typeof src.act];
            if (typeof actVal !== "string") actVal = "";
            if (!actVal && (label === "检查方式" || label === "采集方式与协议") && reqVal) actVal = reqVal;
            const forceAct = label === "数据来源" || label === "性别分布" || label === "年龄分布"
                || label === "地域分布" || label === "采集设备" || label === "采集参数" || label === "数据量";
            if (iAct >= 0 && actVal && (src.hasReturn || forceAct)) next[iAct] = actVal;
            const ok = dd004Meet(label, txt(next[iReq]), txt(next[iAct]), src.act);
            if (ok && iOk >= 0) next[iOk] = ok;
            if (ok === "否") anyNo = true;
            return next;
        });
        return nextTb;
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const fillDd004Numbers = (productId: number, secs: any[]): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        latestDataDoc(productId, "dd_002"),
        ApiHospital.list_prod_hospital({ prod_id: productId, page_index: 0, page_size: 5000 }).catch(() => null),
        loadCaseRowsForDoc(productId).catch(() => []),
    ]).then(([dd002, hp, cases]: any[]) => {
        const rows = parseDd002ReturnRows((dd002 && dd002.content && dd002.content.sections) || []);
        const hospRows = hp && hp.code === ApiHospital.C_OK ? ((hp.data && hp.data.rows) || []) : [];
        const byNo = new Map<string, string>();
        hospRows.forEach((r: any) => {
            const no = String(r.hospital_no || "").trim().toUpperCase();
            if (no) byNo.set(no, String(r.region || "").trim());
        });
        const hospitals = rows.map((r) => ({
            no: r.no,
            region: byNo.get(String(r.no || "").trim().toUpperCase()) || "",
        }));
        const returnSum = rows.reduce((s, r) => s + (parseInt(String(r.qty || "").replace(/[^\d]/g, ""), 10) || 0), 0);
        const qtySum = (cases || []).length || returnSum;
        if (!rows.length && !(cases || []).length) return secs;
        const act = summarizeDd004Actual(hospitals, cases || [], qtySum);
        return applyDd004Numbers(secs, { act, hasReturn: rows.length > 0 });
    }).catch(() => secs);
};

const uniqNames = (...lists: string[][]) => {
    const seen: Record<string, true> = {};
    const names: string[] = [];
    lists.forEach((arr) => {
        (arr || []).forEach((n) => {
            const name = String(n || "").trim();
            if (!name || seen[name]) return;
            seen[name] = true;
            names.push(name);
        });
    });
    return names;
};

const namesByRole = (members: any[], role: string) => {
    const seen: Record<string, true> = {};
    const names: string[] = [];
    (members || []).forEach((m: any) => {
        if (String(m.role || "").trim() !== role) return;
        const name = String(m.name || "").trim();
        if (!name || seen[name]) return;
        seen[name] = true;
        names.push(name);
    });
    return names;
};

const applyDd005Lists = (nodes: any[], annotators: string[], reviewers: string[], examTime = "", dailyDates: string[] = []) => {
    const txt = (s: any) => String(s ?? "").replace(/\s+/g, "");
    const fillBlock = (tb: any[], labelRe: RegExp, names: string[]) => {
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        const slots = Math.max(1, cols - 1);
        let start = -1;
        tb.forEach((row, ri) => {
            if (start >= 0 || !Array.isArray(row)) return;
            if (labelRe.test(txt(row[0]))) start = ri;
        });
        if (start < 0) return tb;
        let end = start + 1;
        while (end < tb.length) {
            const row = tb[end] || [];
            if (txt(row[0])) break;
            end += 1;
        }
        const label = tb[start][0];
        const need = Math.max(1, Math.ceil((names.length || 0) / slots));
        const rows: any[][] = [];
        for (let i = 0; i < need; i++) {
            const row = new Array(cols).fill("");
            row[0] = i === 0 ? label : "";
            for (let s = 0; s < slots; s++) row[s + 1] = names[i * slots + s] || "";
            rows.push(row);
        }
        return [...tb.slice(0, start), ...rows, ...tb.slice(end)];
    };
    const ensureBlocks = (tb: any[]) => {
        const look = tb.map((r) => txt(r?.[0])).join(" ");
        if (!/参与培训人员名单|培训内容概述|培训内容详情/.test(look)) return tb;
        if (tb.some((r) => /参与培训人员名单/.test(txt(r?.[0])))) return tb;
        const cols = Math.max(6, tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0));
        const row = (label: string, extra = "") => {
            const next = new Array(cols).fill("");
            next[0] = label;
            if (extra) next[1] = extra;
            return next;
        };
        const extra = [
            row("参与培训人员名单"),
            row("审核人员"),
            row("培训考核方式", "标注人员对10例数据进行标注，由审核员进行评估。"),
            row("考核通过人员名单"),
        ];
        let ins = tb.length;
        tb.forEach((r, i) => { if (/^培训结果$/.test(txt(r?.[0]))) ins = i; });
        return [...tb.slice(0, ins), ...extra, ...tb.slice(ins)];
    };
    const fillCount = (tb: any[], label: string, n: number | string) =>
        tb.map((row) => {
            if (!Array.isArray(row)) return row;
            const i = row.findIndex((c: any) => txt(c) === label);
            if (i < 0) return row;
            const next = [...row];
            while (next.length <= i + 1) next.push("");
            next[i + 1] = String(n);
            return next;
        });
    const fillDaily = (tb: any[]) => {
        const cols = tb.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
        let headerIdx = -1;
        let iName = -1;
        let iDoc = -1;
        let iAttitude = -1;
        let iScore = -1;
        const gradeIs: number[] = [];
        const dateIs: number[] = [];
        tb.forEach((row, ri) => {
            if (headerIdx >= 0 || !Array.isArray(row)) return;
            const cells = row.map((c: any) => String(c ?? "").trim());
            if (!cells.includes("标注人员姓名")) return;
            headerIdx = ri;
            iName = cells.indexOf("标注人员姓名");
            iDoc = cells.indexOf("审核医生");
            iAttitude = cells.indexOf("工作态度");
            iScore = cells.indexOf("标注质量分数");
            cells.forEach((lab, i) => { if (lab === "日期") dateIs.push(i); });
            ["考勤", "工作专心度", "对反馈的态度", "标记规范程度评级"].forEach((lab) => {
                const i = cells.indexOf(lab);
                if (i >= 0) gradeIs.push(i);
            });
        });
        if (headerIdx < 0 || iName < 0) return tb;
        let footerStart = tb.length;
        for (let i = headerIdx + 1; i < tb.length; i++) {
            if (isSignRow(tb[i]) || (tb[i] || []).some((c: any) => /签字/.test(String(c ?? "")))) {
                footerStart = i;
                break;
            }
        }
        while (footerStart > headerIdx + 1 && rowAllEmpty(tb[footerStart - 1], cols)) footerStart -= 1;
        const oldData = tb.slice(headerIdx + 1, footerStart).filter((row) => Array.isArray(row) && String(row[iName] ?? "").trim() && !isDailyFootRow(row));
        const unused = oldData.slice();
        const pick = (name: string) => {
            const i = unused.findIndex((r) => String(r[iName] ?? "").trim() === name);
            return i >= 0 ? unused.splice(i, 1)[0] : null;
        };
        const iNorm = gradeIs.find((i) => String((tb[headerIdx] || [])[i] ?? "").trim() === "标记规范程度评级");
        const putIfEmpty = (row: any[], i: number, val: string) => {
            if (i < 0) return;
            if (!String(row[i] ?? "").trim()) row[i] = val;
        };
        const fillScores = (row: any[]) => {
            putIfEmpty(row, iAttitude, "合格");
            const emptyGrades = gradeIs.filter((i) => !String(row[i] ?? "").trim());
            const hasB = gradeIs.some((i) => String(row[i] ?? "").trim() === "B");
            if (emptyGrades.length) {
                const bAt = !hasB ? emptyGrades[Math.floor(Math.random() * emptyGrades.length)] : -1;
                emptyGrades.forEach((i) => { row[i] = i === bAt ? "B" : "A"; });
            }
            if (iScore >= 0 && !String(row[iScore] ?? "").trim()) {
                const normB = iNorm != null && String(row[iNorm] ?? "").trim() === "B";
                const lo = 87;
                const hi = normB ? 90 : 97;
                row[iScore] = String(lo + Math.floor(Math.random() * (hi - lo + 1)));
            }
        };
        const newData = annotators.map((name, idx) => {
            const hit = pick(name);
            const next = hit ? [...hit] : new Array(cols).fill("");
            while (next.length < cols) next.push("");
            next[iName] = name;
            if (iDoc >= 0) next[iDoc] = reviewers.length ? reviewers[idx % reviewers.length] : "";
            dateIs.forEach((i) => {
                const norm = toDashDate(String(next[i] ?? ""));
                if (norm) next[i] = norm;
            });
            if (dailyDates.length && dateIs.length) {
                const work = dailyDates[idx % dailyDates.length];
                if (!String(next[dateIs[0]] ?? "").trim()) next[dateIs[0]] = work;
                if (dateIs[1] >= 0 && !String(next[dateIs[1]] ?? "").trim()) {
                    const review = nextDashDate(String(next[dateIs[0]] ?? "") || work);
                    if (review) next[dateIs[1]] = review;
                }
            }
            fillScores(next);
            return next;
        });
        return [...tb.slice(0, headerIdx + 1), ...newData, ...tb.slice(footerStart)];
    };
    const fixTable = (tb: any[]) => {
        if (!Array.isArray(tb) || !tb.length) return tb;
        let next = ensureBlocks(tb);
        next = fillBlock(next, /参与培训人员名单/, annotators);
        next = fillBlock(next, /^审核人员$/, reviewers);
        next = fillBlock(next, /考核通过人员/, annotators);
        next = fillBlock(next, /^参与考核人员$/, annotators);
        next = fillCount(next, "参与考核人数", annotators.length);
        if (examTime) next = fillCount(next, "考核时间", examTime);
        next = fillDaily(next);
        return next;
    };
    const fix = (n: any): any => {
        if (isMetaSection(n)) return { ...n, children: (n.children || []).map(fix) };
        return {
            ...n,
            tables: (n.tables || []).map((tb: any[]) => (Array.isArray(tb) ? fixTable(tb) : tb)),
            children: (n.children || []).map(fix),
        };
    };
    return (nodes || []).map(fix);
};

const fillDd005FromMembers = (productId: number, secs: any[], docType = ""): Promise<any[]> => {
    if (!productId) return Promise.resolve(secs);
    return Promise.all([
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }),
        /^dd_013_/.test(docType)
            ? ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null)
            : Promise.resolve(null),
    ]).then(([res, tl]: any[]) => {
        if (!res || res.code !== Api.C_OK) return secs;
        const members = (res.data && res.data.rows) || [];
        const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
        const examTime = examTimeText(docType, examDatesFromTimeline(tlRows, docType));
        const dailyDates = dailyDatesFromTimeline(tlRows, docType);
        return applyDd005Lists(secs, namesByRole(members, "标注人员"), namesByRole(members, "审核医生"), examTime, dailyDates);
    }).catch(() => secs);
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
        annotators: [] as string[],
        reviewers: [] as string[],
        arbitrators: [] as string[],
        collectors: [] as string[],
        cleaners: [] as string[],
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
                const docType = String(type || doc.doc_type || "");
                if (/^dd_005_/.test(docType) || /^dd_013_/.test(docType)) {
                    loadAnnotators(doc.product_id || 0);
                    fillDd005FromMembers(doc.product_id || 0, withNo, docType).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按参与人员写入名单");
                            else message.error(up.msg || "写入名单失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_002") {
                    fillDd002Hospitals(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按病例明细 TXID 写入回传记录");
                            else message.error(up.msg || "写入回传记录失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_003") {
                    fillDd003FromReturn(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按回传记录写入整理表");
                            else message.error(up.msg || "写入整理表失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_004") {
                    fillDd004Numbers(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按采集需求/回传记录写入需求反馈");
                            else message.error(up.msg || "写入需求反馈失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_010") {
                    fillDd010FromReturn(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按回传记录写入上传记录");
                            else message.error(up.msg || "写入上传记录失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_012") {
                    fillDd012FromProduct(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按产品名称/上传记录写入查重表");
                            else message.error(up.msg || "写入查重表失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_014") {
                    fillDd014FromTimeline(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按时间线写入检查日期");
                            else message.error(up.msg || "写入检查日期失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (/^dd_015_0[123]$/.test(docType)) {
                    fillDd015Stats(doc.product_id || 0, docType, withNo, doc.file_no || "").then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按病例明细/时间线写入统计表");
                            else message.error(up.msg || "写入统计表失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (docType === "dd_011") {
                    fillDd011Feedback(doc.product_id || 0, withNo).then((filled) => {
                        if (JSON.stringify(stripKeys(filled)) === JSON.stringify(stripKeys(withNo))) {
                            dispatch({ loading: false, doc, sections: withNo });
                            return;
                        }
                        dispatch({ loading: false, doc, sections: filled });
                        Api.update_data_doc({
                            id: doc.id,
                            content: { sections: stripKeys(filled) },
                            product_id: doc.product_id,
                            version: doc.version,
                        }).then((up: any) => {
                            if (up.code === Api.C_OK) message.success("已按标注需求/上传记录写入需求反馈");
                            else message.error(up.msg || "写入需求反馈失败");
                        });
                    }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
                    return;
                }
                if (ANN_PID_TYPES.indexOf(docType) < 0) {
                    dispatch({ loading: false, doc, sections: withNo });
                    return;
                }
                const curPids: string[] = [];
                const pickPids = (ns: any[]) => {
                    (ns || []).forEach((n: any) => {
                        if (isMetaSection(n)) { pickPids(n.children || []); return; }
                        (n.tables || []).forEach((tb: any[]) => {
                            let col = -1;
                            (tb || []).forEach((row: any[]) => {
                                if (col < 0) {
                                    const i = (row || []).findIndex((c: any) => String(c ?? "").trim() === "PID");
                                    if (i >= 0) col = i;
                                    return;
                                }
                                const pid = String(row?.[col] ?? "").trim();
                                if (pid) curPids.push(pid);
                            });
                        });
                        pickPids(n.children || []);
                    });
                };
                pickPids(withNo);
                const cachePids = pidsFromCache(doc.product_id || 0);
                const pids = cachePids.length ? cachePids : curPids;
                if (!pids.length) {
                    dispatch({ loading: false, doc, sections: withNo });
                    return;
                }
                Promise.all([
                    ApiTimeline.list_timeline({ prod_id: doc.product_id }).catch(() => null),
                    ApiMember.list_project_member({ prod_id: doc.product_id, page_index: 0, page_size: 1000 }).catch(() => null),
                ]).then(([tl, mb]: any[]) => {
                    const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                    const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                    const fill = buildAnnotMeta(docType, tlRows, members);
                    const filled = applyPidsToSections(withNo, pids, docType, fill);
                    if (annotTableSig(filled) === annotTableSig(withNo)) {
                        dispatch({ loading: false, doc, sections: withNo });
                        return;
                    }
                    dispatch({ loading: false, doc, sections: filled });
                    Api.update_data_doc({
                        id: doc.id,
                        content: { sections: stripKeys(filled) },
                        product_id: doc.product_id,
                        version: doc.version,
                    }).then((up: any) => {
                        if (up.code === Api.C_OK) message.success(`已写入 ${pids.length} 条标注记录`);
                        else message.error(up.msg || "写入标注记录失败");
                    });
                }).catch(() => dispatch({ loading: false, doc, sections: withNo }));
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        const prevId = data.doc.product_id;
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, true, prevId).then((secs) => {
            const docType = String(type || data.doc.doc_type || "");
            if (/^dd_005_/.test(docType) || /^dd_013_/.test(docType)) {
                loadAnnotators(newId);
                fillDd005FromMembers(newId, secs, docType).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_002") {
                fillDd002Hospitals(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_003") {
                fillDd003FromReturn(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_004") {
                fillDd004Numbers(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_010") {
                fillDd010FromReturn(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_012") {
                fillDd012FromProduct(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType === "dd_014") {
                fillDd014FromTimeline(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (/^dd_015_0[123]$/.test(docType)) {
                fillDd015Stats(newId, docType, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                    .catch(() => dispatch({ loading: false, sections: secs }));
                return;
            }
            if (docType !== "dd_011") {
                dispatch({ loading: false, sections: secs });
                return;
            }
            fillDd011Feedback(newId, secs).then((filled) => dispatch({ loading: false, sections: filled }))
                .catch(() => dispatch({ loading: false, sections: secs }));
        });
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

    const loadAnnotators = (productId: number) => {
        const empty = { annotators: [] as string[], reviewers: [] as string[], arbitrators: [] as string[], collectors: [] as string[], cleaners: [] as string[] };
        if (!productId) {
            dispatch(empty);
            return;
        }
        ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch(empty);
                return;
            }
            const members = (res.data && res.data.rows) || [];
            dispatch({
                annotators: namesByRole(members, "标注人员"),
                reviewers: namesByRole(members, "审核医生"),
                arbitrators: namesByRole(members, "仲裁医生"),
                collectors: namesByRole(members, "数据采集人员"),
                cleaners: namesByRole(members, "脱敏+清洗人员"),
            });
        }).catch(() => dispatch(empty));
    };

    const applyCell = (sections: any[], key: string, ti: number, r: number, ci: number, val: string, colSpan = 1, rowSpan = 1) =>
        mapNode(sections, key, (n: any) => ({
            ...n,
            tables: ((n.tables) || []).map((tb: any[], i: number) => {
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
        }));

    const setCell = (key: string, ti: number, r: number, ci: number, val: string, colSpan = 1, rowSpan = 1) => {
        setSections(applyCell(data.sections, key, ti, r, ci, val, colSpan, rowSpan));
    };

    const setCellAndSave = (key: string, ti: number, r: number, ci: number, val: string, colSpan = 1, rowSpan = 1) => {
        const next = applyCell(data.sections, key, ti, r, ci, val, colSpan, rowSpan);
        dispatch({ sections: next });
        if (!id) return;
        dispatch({ saving: true });
        Api.update_data_doc({
            id,
            content: { sections: stripKeys(next) },
            product_id: data.doc.product_id,
            version: data.doc.version,
        }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
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

    const backPath = `/data_docs/${getDataDocListType(type || data.doc.doc_type) || "dd_002"}`;

    const renderTable = (n: any, ti: number, tb: any[]) => {
        const docType = String(type || data.doc.doc_type || "");
        const isUpload = docType === "dd_010";
        const isDailyEval = /^dd_013_0[567]$/.test(docType);
        const noCellMerge = docType === "dd_eq" || docType === "dd_002" || isUpload
            || /^(dd_008_|dd_009_|dd_013_0[567])/.test(docType);
        const cols = tb.reduce((m: number, row: any[]) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
        const firstBody = tb.findIndex((row: any[]) =>
            !onlyFirstRow(row, cols) && (row || []).some((c: any) => String(c ?? "").trim())
        );
        const headerMergeRows = new Set<number>();
        if (docType === "dd_003" && firstBody >= 0) {
            headerMergeRows.add(firstBody);
            const sub = tb[firstBody + 1] || [];
            if (!String(sub[0] ?? "").trim() && sub.slice(1).some((c: any) => String(c ?? "").trim())) {
                headerMergeRows.add(firstBody + 1);
            }
        }
        const nameBlockRows = new Set<number>();
        let inNameBlock = false;
        tb.forEach((row, r) => {
            const a = String(row?.[0] ?? "").replace(/\s+/g, "");
            if (/^(参与考核人员|参与培训人员名单|审核人员|检查人员)$/.test(a) || /^考核通过人员/.test(a)) {
                inNameBlock = true;
                nameBlockRows.add(r);
                return;
            }
            if (inNameBlock && !a) {
                nameBlockRows.add(r);
                return;
            }
            inNameBlock = false;
        });
        const leftTextRows = new Set<number>();
        let inLeftText = false;
        tb.forEach((row, r) => {
            const a = String(row?.[0] ?? "").replace(/\s+/g, "");
            if (/^(考核要点|本次考核细则|培训内容概述|培训内容详情|培训考核方式)$/.test(a)) {
                inLeftText = true;
                leftTextRows.add(r);
                return;
            }
            if (inLeftText && !a) {
                leftTextRows.add(r);
                return;
            }
            inLeftText = false;
        });
        let emptyMergeRows: Set<number> | undefined;
        if (docType === "dd_003") emptyMergeRows = headerMergeRows;
        else if (docType === "dd_012") {
            emptyMergeRows = new Set<number>();
            tb.forEach((row, r) => {
                if (onlyFirstRow(row, cols) || String(row?.[0] ?? "").trim() === "所属项目") emptyMergeRows!.add(r);
            });
        }
        else if (nameBlockRows.size) {
            emptyMergeRows = new Set<number>();
            tb.forEach((_: any, r: number) => { if (!nameBlockRows.has(r)) emptyMergeRows!.add(r); });
        }
        const baseSpans = noCellMerge ? null : computeRecordSpans(tb, emptyMergeRows);
        let spans = mergeDd003ProductName(tb, mergeNameLabelCol(tb, baseSpans, nameBlockRows), firstBody);
        if (docType === "dd_004") spans = mergeDd004ReqAct(tb, spans);
        if (docType === "dd_010") spans = mergeDd010ProductName(tb, spans, firstBody);
        if (docType === "dd_012") spans = mergeDd012Project(tb, spans);
        const headerRow = firstBody >= 0 ? (tb[firstBody] || []) : [];
        const dd003UnitI = docType === "dd_003" && firstBody >= 0
            ? headerRow.findIndex((c: any) => /采集单位/.test(String(c ?? "").trim()))
            : -1;
        const dd003HasSub = docType === "dd_003" && firstBody >= 0
            && Array.isArray(tb[firstBody + 1])
            && (tb[firstBody + 1] || []).some((c: any) => /检查方式|数据量/.test(String(c ?? "")));
        const dd003DataStart = firstBody >= 0 ? firstBody + (dd003HasSub ? 2 : 1) : -1;
        return (
            <div key={ti} style={{ marginBottom: 8, overflowX: (isUpload || isDailyEval) ? "auto" : "visible" }}>
                <table style={(isUpload || isDailyEval) ? { ...tableStyle, tableLayout: "auto", minWidth: isUpload ? 1280 : 1180 } : tableStyle}>
                    <tbody>
                        {tb.map((row: any[], r: number) => {
                            const banner = onlyFirstRow(row, cols);
                            const bannerText = String(row[0] ?? "").trim();
                            if (banner && (looksLikeFileNo(bannerText) || bannerText === meta.title || r <= 1)) return null;
                            const emptyRow = rowAllEmpty(row, cols);
                            if (emptyRow) return null;
                            if (isDailyFootRow(row)) return null;
                            const allSkip = Array.from({ length: cols }, (_, ci) => !!spans?.[r]?.[ci]?.skip).every(Boolean);
                            if (allSkip) return <tr key={r} />;
                            const subHead = firstBody >= 0 && r === firstBody + 1
                                && !String(row[0] ?? "").trim()
                                && row.slice(1).some((c: any) => String(c ?? "").trim());
                            const prodBanner = docType === "dd_003" && r === dd003DataStart
                                && String(row[0] ?? "").trim()
                                && (dd003UnitI < 0 || !String(row[dd003UnitI] ?? "").trim());
                            const isHeadRow = banner || r === firstBody || subHead || !!prodBanner;
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
                                    const colLabel = String(headerRow[ci] ?? "").trim();
                                    const prevLabel = String(row[ci - 1] ?? "").trim();
                                    const rotatePerson = (
                                        colLabel === "标注人员"
                                        || colLabel === "审核医生"
                                        || colLabel === "标注人员姓名"
                                        || colLabel === "仲裁医生"
                                        || colLabel === "数据采集负责人"
                                        || colLabel === "脱敏检查、清洗人员"
                                        || colLabel === "上传人员"
                                        || colLabel === "检查人"
                                        || /^测试医生/.test(colLabel)
                                    );
                                    const personPick = !isHeadRow && !sign && !isDailyFootRow(row) && (
                                        (/^dd_005_/.test(docType) && /^(讲解人员|记录人)$/.test(prevLabel))
                                        || rotatePerson
                                    );
                                    const datePick = isDailyEval && !isHeadRow && !sign && !isDailyFootRow(row) && colLabel === "日期";
                                    const testers = uniqNames(data.reviewers || [], data.arbitrators || []);
                                    const pickNames = /^测试医生/.test(colLabel) ? testers
                                        : colLabel === "审核医生" ? (data.reviewers || [])
                                        : colLabel === "仲裁医生" ? (data.arbitrators || [])
                                        : colLabel === "数据采集负责人" ? (data.collectors || [])
                                        : (colLabel === "脱敏检查、清洗人员" || colLabel === "上传人员" || colLabel === "检查人")
                                            ? (data.cleaners || [])
                                            : (data.annotators || []);
                                    const pickPh = /^测试医生/.test(colLabel) ? "选择测试医生"
                                        : colLabel === "审核医生" ? "选择审核医生"
                                        : colLabel === "仲裁医生" ? "选择仲裁医生"
                                        : colLabel === "数据采集负责人" ? "选择采集负责人"
                                        : (colLabel === "脱敏检查、清洗人员" || colLabel === "上传人员" || colLabel === "检查人")
                                            ? "选择人员"
                                            : "选择标注人员";
                                    const isPath = isUpload && PATH_LABELS.has(colLabel);
                                    const leftText = leftTextRows.has(r) && ci > 0;
                                    const align = /^(评估人|复核人)/.test(String(cell ?? "").trim()) || isPath || leftText ? "left" : "center";
                                    const st: CSSProperties = {
                                        ...(isHeadRow ? tdHead : tdValue),
                                        textAlign: isHeadRow ? "center" : align,
                                        ...(leftText ? { paddingLeft: 12 } : {}),
                                        ...(isUpload ? { minWidth: uploadColMin(colLabel), ...(isPath ? { wordBreak: "break-all" } : {}) } : {}),
                                        ...(datePick ? { minWidth: 148, whiteSpace: "nowrap", padding: "4px 6px" } : {}),
                                    };
                                    return (
                                        <td
                                            key={ci}
                                            colSpan={cs > 1 ? cs : undefined}
                                            rowSpan={rs > 1 ? rs : undefined}
                                            style={st}
                                        >
                                            {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                <img src={cell} alt="" style={{ maxHeight: 36 }} />
                                            ) : personPick ? (
                                                <Select
                                                    variant="borderless"
                                                    value={String(cell ?? "").trim() || undefined}
                                                    disabled={readonly}
                                                    placeholder={pickPh}
                                                    style={{ width: "100%", textAlign: "center", fontSize: 13 }}
                                                    options={(String(cell ?? "").trim() && pickNames.indexOf(String(cell ?? "").trim()) < 0
                                                        ? [String(cell ?? "").trim(), ...pickNames]
                                                        : pickNames
                                                    ).map((name: string) => ({ value: name, label: name }))}
                                                    onChange={(v) => setCellAndSave(n._key, ti, r, ci, v || "", cs, rs)}
                                                />
                                            ) : datePick ? (
                                                <DatePicker
                                                    variant="borderless"
                                                    allowClear
                                                    value={(() => {
                                                        const dash = toDashDate(String(cell ?? ""));
                                                        return dash ? dayjs(dash) : null;
                                                    })()}
                                                    disabled={readonly}
                                                    placeholder="选择日期"
                                                    format="YYYY-MM-DD"
                                                    style={{ width: 138 }}
                                                    onChange={(d) => setCellAndSave(n._key, ti, r, ci, d ? d.format("YYYY-MM-DD") : "", cs, rs)}
                                                />
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
                    <div style={{
                        padding: "12px 20px",
                        maxWidth: String(type || data.doc.doc_type || "") === "dd_010"
                            ? "100%"
                            : (maxTableCols(data.sections) > 8 ? 1600 : 1100),
                    }}>
                        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, margin: "4px 0 6px" }}>{meta.title}</div>
                        <div style={{ textAlign: "center", color: "#999", marginBottom: 14 }}>{data.doc.file_no || ""}</div>
                        {(data.sections || []).map((n: any) => renderSection(n))}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
