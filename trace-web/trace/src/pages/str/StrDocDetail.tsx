import { Button, Input, Modal, Space, Spin, message, Upload } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, ArrowUpOutlined, ArrowDownOutlined, UploadOutlined} from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiStrDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewRecordTables from "@/pages/doc_fill/ReviewRecordTables";
import * as echarts from "echarts";
import "../pdp/PdpDocDetail.less";
import {
    buildFreeSegments,
    chapterAllowsAboveTable,
    freeAddBodyBlock,
    freePlaceAbove,
    freeAddImage,
    freeAddTable,
    freeDelImage,
    freeDelTable,
    freeReplaceImage,
    reassembleFreeBody,
    shouldUseFreeInterleave,
    appendBodyLine,
    ensureMediaPlaceholders,
    removeNthPlaceholder,
} from "../pdp/freeChapterBlocks";
import { FreeSideActions } from "../pdp/FreeChapterContent";
import { syncDocVersionFields } from "@/pages/doc_fill/syncDocVersion";

// 兼容性表首列「测试模块」连续相同项合并：返回 {行号: 跨行数(0=被合并跳过)}，非兼容性表返回 null
const compatMerge = (tb: any[]): Record<number, number> | null => {
    if (!tb || !tb.length || String((tb[0] || [])[0] || "").trim() !== "测试模块") return null;
    let hdr = 0;
    while (hdr < tb.length && String((tb[hdr] || [])[0] || "").trim() === "测试模块") hdr++;
    const g: Record<number, number> = {};
    let r = hdr;
    while (r < tb.length) {
        const val = String((tb[r] || [])[0] || "").trim();
        let r2 = r;
        while (r2 + 1 < tb.length && val && String((tb[r2 + 1] || [])[0] || "").trim() === val) r2++;
        g[r] = r2 - r + 1;
        for (let k = r + 1; k <= r2; k++) g[k] = 0;
        r = r2 + 1;
    }
    return g;
};

const isEquipInfoTable = (tb: any[]): boolean =>
    ((tb?.[0] || []) as any[]).some((c) => String(c || "").includes("设备信息"));

const cellAutoSize = (tb: any[], ci: number, value: any) => {
    const header = String((tb?.[0] || [])[ci] || "");
    if (!header.includes("设备信息")) return { minRows: 1, maxRows: 8 };
    const lines = String(value ?? "").split("\n").length;
    return { minRows: Math.min(40, Math.max(lines, 1)), maxRows: 40 };
};

// 兼容性表：表头行数（连续以"测试模块"开头的行）
const compatHdrCount = (tb: any[]): number => {
    if (!tb || !tb.length || String((tb[0] || [])[0] || "").trim() !== "测试模块") return 0;
    let hdr = 0;
    while (hdr < tb.length && String((tb[hdr] || [])[0] || "").trim() === "测试模块") hdr++;
    return hdr;
};

// 兼容性表单元格合并计划：表头(测试模块/测试点跨行、版本组跨列) + 数据区首列跨行
const compatSpan = (tb: any[], mg: Record<number, number> | null, r: number, ci: number): { skip?: boolean; rowSpan?: number; colSpan?: number } => {
    if (!mg) return {};
    const hdr = compatHdrCount(tb);
    if (r < hdr) {
        if (ci <= 1) return r === 0 ? { rowSpan: hdr } : { skip: true };
        if (r === 0) {
            const v = String((tb[0] || [])[ci] || "");
            if (ci > 2 && String((tb[0] || [])[ci - 1] || "") === v) return { skip: true };
            let span = 1;
            while (ci + span < (tb[0] || []).length && String((tb[0] || [])[ci + span] || "") === v) span++;
            return span > 1 ? { colSpan: span } : {};
        }
        return {};
    }
    if (ci === 0) {
        if (mg[r] === 0) return { skip: true };
        if (mg[r] > 1) return { rowSpan: mg[r] };
    }
    return {};
};

// 单元测试项表：仅「需求编号」「设计编号」连续相同非空纵向合并
const isUnitTestItemTable = (tb: any[]): boolean => {
    const h = (tb?.[0] || []).map((c: any) => String(c || "").trim());
    return h.includes("需求编号") && h.includes("设计编号");
};

type UnitSpans = { hide: boolean[][]; rowSpan: number[][] };

const unitItemSpans = (tb: any[]): UnitSpans | null => {
    if (!isUnitTestItemTable(tb)) return null;
    const header = (tb[0] || []).map((c: any) => String(c || "").trim());
    const mergeCols = header
        .map((name: string, i: number) => (name === "需求编号" || name === "设计编号" ? i : -1))
        .filter((i: number) => i >= 0);
    if (!mergeCols.length) return null;
    const n = tb.length;
    const cols = header.length;
    const hide = Array.from({ length: n }, () => Array(cols).fill(false));
    const rowSpan = Array.from({ length: n }, () => Array(cols).fill(1));
    const text = (r: number, c: number) => String((tb[r] || [])[c] ?? "").trim();
    for (const c of mergeCols) {
        let r = 1;
        while (r < n) {
            const val = text(r, c);
            if (!val) {
                r += 1;
                continue;
            }
            let r2 = r;
            while (r2 + 1 < n && text(r2 + 1, c) === val) r2 += 1;
            if (r2 > r) {
                rowSpan[r][c] = r2 - r + 1;
                for (let rr = r + 1; rr <= r2; rr++) hide[rr][c] = true;
            }
            r = r2 + 1;
        }
    }
    return { hide, rowSpan };
};

/** 缺陷统计表：表头含 Bug级别，且存在「用例总数」行 */
const isDefectStatTable = (tb: any[]): boolean => {
    if (!tb?.length || !Array.isArray(tb[0])) return false;
    const hj = (tb[0] || []).map((c: any) => String(c || "").trim()).join(" ");
    if (!hj.includes("Bug级别")) return false;
    return tb.some((row: any[]) => Array.isArray(row) && String(row[0] || "").trim().startsWith("用例总数"));
};

/** 「用例总数」行：从第 2 列（下标 1）起合并到行末 */
const defectCaseTotalSpan = (
    tb: any[],
    r: number,
    ci: number,
): { skip?: boolean; colSpan?: number } => {
    if (!isDefectStatTable(tb) || r <= 0 || r >= tb.length) return {};
    const lab = String((tb[r] || [])[0] || "").trim();
    if (!lab.startsWith("用例总数")) return {};
    const cols = Math.max((tb[0] || []).length, (tb[r] || []).length);
    if (ci === 1) return cols > 1 ? { colSpan: cols - 1 } : {};
    if (ci > 1) return { skip: true };
    return {};
};

const tableCellSpan = (
    tb: any[],
    mg: Record<number, number> | null,
    us: UnitSpans | null,
    r: number,
    ci: number,
): { skip?: boolean; rowSpan?: number; colSpan?: number } => {
    const cs = compatSpan(tb, mg, r, ci);
    if (cs.skip || cs.rowSpan || cs.colSpan) return cs;
    const ds = defectCaseTotalSpan(tb, r, ci);
    if (ds.skip || ds.colSpan) return ds;
    if (!us) return {};
    if (us.hide[r]?.[ci]) return { skip: true };
    const rs = us.rowSpan[r]?.[ci] || 1;
    return rs > 1 ? { rowSpan: rs } : {};
};

// 离屏渲染阶段折线图（x=功能点, y=用例个数, 是否通过线），返回 PNG dataURL
const buildChartUrl = (title: string, funcs: string[], counts: number[], flags: number[]): string => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:-99999px;top:0;width:1100px;height:340px;";
    document.body.appendChild(el);
    const chart = echarts.init(el);
    chart.setOption({
        animation: false,
        title: { text: title, left: "center", textStyle: { fontSize: 14 } },
        legend: { data: ["用例个数", "是否通过"], bottom: 0 },
        grid: { left: 40, right: 20, top: 40, bottom: 100 },
        xAxis: { type: "category", data: funcs, axisLabel: { rotate: 60, fontSize: 8, interval: 0 } },
        yAxis: { type: "value" },
        series: [
            { name: "用例个数", type: "line", data: counts, itemStyle: { color: "#4472C4" }, lineStyle: { color: "#4472C4" } },
            { name: "是否通过", type: "line", data: flags, itemStyle: { color: "#ED7D31" }, lineStyle: { color: "#ED7D31" } },
        ],
    });
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    chart.dispose();
    document.body.removeChild(el);
    return url;
};

// 缺陷统计柱状图：cats=级别, series=[{name,data}]
const buildBarChartUrl = (title: string, cats: string[], series: { name: string; data: number[]; stack?: string }[]): string => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:-99999px;top:0;width:900px;height:360px;";
    document.body.appendChild(el);
    const chart = echarts.init(el);
    chart.setOption({
        animation: false,
        title: { text: title, left: "center", textStyle: { fontSize: 14 } },
        legend: { data: series.map((s) => s.name), bottom: 0 },
        grid: { left: 50, right: 20, top: 40, bottom: 50 },
        xAxis: { type: "category", data: cats },
        yAxis: { type: "value", minInterval: 1 },
        series: series.map((s) => ({ name: s.name, type: "bar", stack: s.stack, data: s.data, label: { show: true, position: s.stack ? "inside" : "top", fontSize: 10 } })),
    });
    const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
    chart.dispose();
    document.body.removeChild(el);
    return url;
};

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// 从「产品时间逻辑线」计算产品开发周期：取输出含「产品开发」活动（排除「产品开发计划」文档）的日期，
// 最早=开发开始、最晚=开发结束。格式「YYYY年M月~M月」（同年省略后段年份，跨年则完整显示）。
const computeCycle = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const isDevRow = (r: any) => Object.values(r.cells || {}).some(
        (val: any) => /产品开发(?!计划)/.test(String(val || ""))
    );
    const dates = (rows || [])
        .filter((r: any) => (r.row_type || "date") === "date" && isDevRow(r))
        .map((r: any) => ({ y: num(r.year), m: num(r.month), d: num(r.day) }))
        .filter((x: any) => !isNaN(x.y) && !isNaN(x.m));
    if (!dates.length) return "";
    const key = (x: any) => x.y * 10000 + x.m * 100 + (isNaN(x.d) ? 0 : x.d);
    let min = dates[0];
    let max = dates[0];
    dates.forEach((x: any) => { if (key(x) < key(min)) min = x; if (key(x) > key(max)) max = x; });
    return min.y === max.y ? `${min.y}年${min.m}月~${max.m}月` : `${min.y}年${min.m}月~${max.y}年${max.m}月`;
};

// 从时间线里找「软件测试报告」文件所在行的日期（取最早匹配行），格式「YYYY年M月D日」
const computeFileDate = (rows: any[], keyword = "软件测试报告"): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const matches = (rows || []).filter((r: any) =>
        (r.row_type || "date") === "date" && Object.values(r.cells || {}).some((v: any) => String(v || "").includes(keyword))
    );
    if (!matches.length) return "";
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) < key(best)) best = r; });
    return `${num(best.year)}年${num(best.month)}月${num(best.day)}日`;
};

// 里程碑日期辅助：num/日期键/格式化 YYYY年M月D日
const mNum = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
const mDateKey = (r: any) => mNum(r.year) * 10000 + mNum(r.month) * 100 + (mNum(r.day) || 0);
const mFmtYMD = (r: any) => `${mNum(r.year)}年${mNum(r.month)}月${mNum(r.day) || 1}日`;

// 产品开发结束日 = 时间线「产品开发」活动（排除「产品开发计划」）的最晚日期
const computeDevEnd = (rows: any[]): string => {
    const m = (rows || []).filter((r: any) => (r.row_type || "date") === "date"
        && Object.values(r.cells || {}).some((v: any) => /产品开发(?!计划)/.test(String(v || ""))));
    if (!m.length) return "";
    return mFmtYMD(m.reduce((a: any, b: any) => (mDateKey(b) > mDateKey(a) ? b : a)));
};

// 按关键字匹配时间线活动，取最晚日期（YYYY年M月D日）
const latestDateFor = (rows: any[], keys: string[]): string => {
    const m = (rows || []).filter((r: any) => (r.row_type || "date") === "date"
        && Object.values(r.cells || {}).some((v: any) => keys.some((k) => String(v || "").includes(k))));
    if (!m.length) return "";
    return mFmtYMD(m.reduce((a: any, b: any) => (mDateKey(b) > mDateKey(a) ? b : a)));
};

// 里程碑阶段日期：以产品开发周期（开始~结束）按比例拆分
// 基础代码开发=开始+1/4、模块开发=开始+3/4、整体联调=结束日、封装安装包=结束日+1天
const computeDevPhases = (rows: any[]): { base: string; module: string; integ: string; pkg: string } => {
    const empty = { base: "", module: "", integ: "", pkg: "" };
    const m = (rows || []).filter((r: any) => (r.row_type || "date") === "date"
        && Object.values(r.cells || {}).some((v: any) => /产品开发(?!计划)/.test(String(v || "")))
        && !isNaN(mNum(r.year)) && !isNaN(mNum(r.month)));
    if (!m.length) return empty;
    const start = m.reduce((a: any, b: any) => (mDateKey(b) < mDateKey(a) ? b : a));
    const end = m.reduce((a: any, b: any) => (mDateKey(b) > mDateKey(a) ? b : a));
    const toDate = (r: any) => new Date(mNum(r.year), mNum(r.month) - 1, mNum(r.day) || 1);
    const ds = toDate(start);
    const de = toDate(end);
    const total = Math.round((de.getTime() - ds.getTime()) / 86400000);
    const addDays = (b: Date, n: number) => new Date(b.getTime() + n * 86400000);
    const fmt = (dt: Date) => `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
    return {
        base: fmt(addDays(ds, Math.round(total * 0.25))),
        module: fmt(addDays(ds, Math.round(total * 0.75))),
        integ: fmt(de),
        pkg: fmt(addDays(de, 1)),
    };
};

const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n,
        _key: n._key || genKey(),
        body: n.body ?? "",
        tables: Array.isArray(n.tables) ? n.tables : [],
        images: Array.isArray(n.images) ? n.images : [],
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

/** 同级交换位置：dir=-1 上移，dir=1 下移；找不到或越界则原样返回 */
const moveSibling = (nodes: any[], key: string, dir: -1 | 1): any[] => {
    const list = nodes || [];
    const idx = list.findIndex((n: any) => n._key === key);
    if (idx >= 0) {
        const j = idx + dir;
        if (j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
    }
    return list.map((n: any) => ({ ...n, children: moveSibling(n.children || [], key, dir) }));
};

const firstKey = (nodes: any[]): string => (nodes && nodes[0] ? nodes[0]._key : "");

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

const TEST_STAGE_TITLES = new Set(["单元测试", "集成测试", "系统测试"]);
const isTestStageChapter = (n: any) => TEST_STAGE_TITLES.has(stripNum(n?.title));
/** 无表或仅表头/全空行 → 视为空章节，可显示「自动获取」 */
const isEmptyTestStageTable = (n: any) => {
    const tb = (n?.tables || [])[0];
    if (!tb || !Array.isArray(tb) || tb.length <= 1) return true;
    return tb.slice(1).every(
        (r: any) => !Array.isArray(r) || r.every((c: any) => !String(c ?? "").trim()),
    );
};
const showTestItemPull = (n: any) => isTestStageChapter(n) && isEmptyTestStageTable(n);

/** 兼容性：Win10/Win11 测试项列表、用户端测试 */
const compatKindOf = (n: any): "" | "win" | "client" => {
    const t = stripNum(n?.title);
    if (t === "用户端测试" || (t.startsWith("用户端") && t.includes("测试") && !t.includes("服务端"))) return "client";
    if (t.includes("Win10") && t.includes("测试项")) return "win";
    if (t.includes("Win11") && t.includes("测试项")) return "win";
    return "";
};
const isEmptyCompatModuleTable = (n: any) => {
    const tb = (n?.tables || [])[0];
    if (!tb || !Array.isArray(tb) || !tb.length) return true;
    let i = 0;
    while (i < tb.length && Array.isArray(tb[i]) && String(tb[i][0] || "").trim() === "测试模块") i += 1;
    const data = tb.slice(i);
    if (!data.length) return true;
    return data.every(
        (r: any) => !Array.isArray(r) || r.every((c: any) => !String(c ?? "").trim()),
    );
};
const showCompatPull = (n: any) => !!compatKindOf(n) && isEmptyCompatModuleTable(n);

const applyTestItemFill = (sections: any[], key: string, tables: any[]): any[] => {
    const walk = (nodes: any[]): any[] =>
        (nodes || []).map((n: any) => {
            const kids = n.children || [];
            if (kids.some((c: any) => c._key === key)) {
                const children = kids.map((c: any) => (c._key === key ? { ...c, tables } : c));
                const stages = children.map((c: any) => stripNum(c.title)).filter(Boolean);
                return { ...n, ref_type: "test_items", stages, children };
            }
            if (n._key === key) return { ...n, tables };
            return { ...n, children: walk(kids) };
        });
    return walk(sections);
};

const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "revision" || n.ref_type === "review" || n.ref_type === "attachment") {
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
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");

    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        pulling: false,
        charting: false,
        doc: {} as any,
        sections: [] as any[],
        activeKey: "",
        products: [] as any[],
    });

    // 加载时按产品自动填充：项目简介=「产品名称：xxx」，项目开发时间=时间逻辑线最早~最晚
    const autoFillProduct = (nodes: any[], info: { name?: string; desc?: string; cycle?: string }): any[] => {
        const name = String(info.name || "").trim();
        const desc = String(info.desc || "").trim();
        const cycle = String(info.cycle || "").trim();
        const fix = (n: any): any => {
            let body = n.body;
            const isOverview = n.ref_type === "prod_overview"
                || (stripNum(n.title) === "产品概况" && (n.children || []).length === 0);
            const isCycle = n.ref_type === "prod_cycle"
                || (stripNum(n.title) === "项目开发时间" && (n.children || []).length === 0);
            if ((n.ref_type === "prod_name" || stripNum(n.title) === "项目简介") && name) {
                body = `产品名称：${name}`;
            } else if (isOverview) {
                body = desc;
            } else if (isCycle && cycle) {
                body = cycle;
            }
            return { ...n, body, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 文件修订记录：日期/版本/说明仅填空；修订人=测试人员(日期规则)、批准人=研发负责人始终覆盖
    const fillRevision = (nodes: any[], info: { fileDate?: string; version?: string; reviser?: string; approver?: string }): any[] => {
        const fix = (n: any): any => {
            const isRev = n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
            let tables = n.tables;
            if (isRev && Array.isArray(n.tables) && Array.isArray(n.tables[0])) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const cols = (t[0] || []).length || 5;
                while (t.length < 6) t.push(new Array(cols).fill(""));
                const row = t[1];
                while (row.length < 5) row.push("");
                const setIf = (i: number, val: any) => { if (val && !String(row[i] || "").trim()) row[i] = val; };
                setIf(0, info.fileDate);
                if (info.version && !String(row[1] || "").trim()) row[1] = info.version;
                if (!String(row[2] || "").trim()) row[2] = "首次发布";
                if (info.reviser) row[3] = info.reviser;
                if (info.approver) row[4] = info.approver;
                tables = [t, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 里程碑表：计划完成时间（评审开发计划→开发计划评审日；其余→开发结束日，仅填空）
    // 负责人（可判定则覆盖）：评审行→TPM；任务含模块名→该模块参与人员（备注 前端-xxx/后端-xxx）；联调/整体行→全体参与
    const fillMilestone = (
        nodes: any[],
        info: {
            devEnd?: string; planDate?: string; tpm?: string;
            moduleMap?: Record<string, string[]>;
            phases?: { base: string; module: string; integ: string; pkg: string };
        },
    ): any[] => {
        const moduleMap = info.moduleMap || {};
        const modKeys = Object.keys(moduleMap);
        const ph = info.phases || { base: "", module: "", integ: "", pkg: "" };
        const fix = (n: any): any => {
            const isMile = n.ref_type === "milestone" || stripNum(n.title).includes("里程碑");
            let tables = n.tables;
            if (isMile && Array.isArray(n.tables) && Array.isArray(n.tables[0]) && n.tables[0].length) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const header = t[0] || [];
                const colOf = (name: string) => header.findIndex((h: any) => String(h || "").includes(name));
                const cTime = colOf("计划完成时间");
                const cOwner = colOf("负责人");
                const cStage = colOf("阶段");
                for (let i = 1; i < t.length; i++) {
                    const row = t[i];
                    if (!Array.isArray(row)) continue;
                    const rowText = row.map((c: any) => String(c || "")).join(" ");
                    const lower = rowText.toLowerCase();
                    const isReview = rowText.includes("评审") && rowText.includes("开发计划");
                    // 计划完成时间（可判定则覆盖）：评审→评审日；基础代码/模块/联调按周期比例；封装安装包→结束日+1天
                    if (cTime >= 0 && cTime < row.length) {
                        const stage = cStage >= 0 && cStage < row.length ? String(row[cStage] || "") : rowText;
                        let dt = "";
                        if (isReview) dt = info.planDate || info.devEnd || "";
                        else if (/安装包|封装/.test(rowText)) dt = ph.pkg;
                        else if (stage.includes("基础")) dt = ph.base;
                        else if (stage.includes("模块")) dt = ph.module;
                        else if (stage.includes("联调") || stage.includes("整体")) dt = ph.integ;
                        else dt = info.devEnd || "";
                        if (dt) row[cTime] = dt;
                    }
                    if (cOwner >= 0 && cOwner < row.length) {
                        let owner = "";
                        if (isReview) {
                            owner = info.tpm || "";
                        } else {
                            const names: string[] = [];
                            modKeys.forEach((k) => {
                                if (k && lower.includes(k)) {
                                    moduleMap[k].forEach((nm) => { if (nm && !names.includes(nm)) names.push(nm); });
                                }
                            });
                            if (names.length) owner = names.join("、");
                            else if (/联调|整体|全体/.test(rowText)) owner = "全体参与";
                        }
                        if (owner) row[cOwner] = owner;
                    }
                }
                tables = [t, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 按产品重新获取并填充所有自动获取内容（项目简介/开发时间 + 文件修订记录 + 里程碑）
    const autofill = (productId: number, secs: any[], version: string): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
            ]).then(([pr, tl, mb]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const findRole = (pred: (role: string) => boolean) => {
                    const hit = members.find((m: any) => pred(String(m.role || "")));
                    return hit ? String(hit.name || "").trim() : "";
                };
                // 备注模块映射：备注 前端-NeoViewer / 后端-DP 等 → 取"-"后模块名(小写) → 参与人员姓名
                const moduleMap: Record<string, string[]> = {};
                members.forEach((m: any) => {
                    const note = String(m.note || "").trim();
                    const nm = String(m.name || "").trim();
                    const idx = note.lastIndexOf("-");
                    if (!nm || idx < 0) return;
                    const mod = note.slice(idx + 1).trim().toLowerCase();
                    if (!mod) return;
                    (moduleMap[mod] = moduleMap[mod] || []).push(nm);
                });
                let out = autoFillProduct(secs, {
                    name: prod.name,
                    desc: prod.overall_desc,
                    cycle: computeCycle(tlRows),
                });
                const fileDate = computeFileDate(tlRows);
                const m = String(fileDate || "").match(/(\d{4})\D+(\d{1,2})/);
                const before202509 = m ? (Number(m[1]) * 100 + Number(m[2]) < 202509) : false;
                out = fillRevision(out, {
                    fileDate,
                    version,
                    // 修订人=测试人员（2025.09 前宋月 / 之后孙家旭）；批准人=研发负责人
                    reviser: before202509 ? "宋月" : "孙家旭",
                    approver: findRole((r) => r.includes("研发负责人")),
                });
                out = fillMilestone(out, {
                    devEnd: computeDevEnd(tlRows),
                    planDate: latestDateFor(tlRows, ["软件测试报告"]),
                    tpm: findRole((r) => r.toUpperCase().includes("TPM")),
                    moduleMap,
                    phases: computeDevPhases(tlRows),
                });
                resolve(syncDocVersionFields(out, version));
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_str_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = ensureKeys((doc.content && doc.content.sections) || []);
            autofill(doc.product_id, sections, doc.version).then((secs) => {
                dispatch({ loading: false, doc, sections: secs, activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
            });
        });
    };

    const rebindProduct = (newId: number) => {
        if (!id || newId === data.doc.product_id) return;
        Modal.confirm({
            title: "切换产品",
            content: "切换产品将重新获取自动填充内容，未保存的修改会丢失，是否继续？",
            okText: "切换",
            cancelText: "取消",
            onOk: () => {
                dispatch({ loading: true });
                Api.rebind_product({ id, product_id: newId }).then((res: any) => {
                    if (res.code !== Api.C_OK) { dispatch({ loading: false }); message.error(res.msg); return; }
                    const doc = res.data || {};
                    const sections = ensureKeys((doc.content && doc.content.sections) || []);
                    autofill(newId, sections, doc.version).then((secs) => {
                        dispatch({ loading: false, doc, sections: secs, activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
                    }).catch(() => {
                        dispatch({ loading: false, doc, sections, activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstKey(sections) });
                    });
                });
            },
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
        const sections = [...data.sections];
        const reviewAt = sections.findIndex((n: any) => n.ref_type === "review" || String(n.title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").includes("评审记录"));
        if (reviewAt >= 0) sections.splice(reviewAt, 0, node);
        else sections.push(node);
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
    };
    const moveNode = (key: string, dir: -1 | 1) => {
        setSections(moveSibling(data.sections, key, dir));
    };

    // ---- 当前章节的表格操作 ----
    const active = findNode(data.sections, data.activeKey);
    const updateTables = (tables: any[]) => patchNode(data.activeKey, { tables });
    const setCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = (active.tables || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.map((row: any[], ri: number) =>
                ri !== r ? row : row.map((cell: any, cc: number) => (cc === ci ? val : cell))
            )
        );
        updateTables(tables);
    };
    const insertRowAfter = (ti: number, r: number) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cols = tb[0] ? tb[0].length : 1;
            const next = [...tb];
            next.splice(r + 1, 0, new Array(cols).fill(""));
            return next;
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
    const addTable = () => {
        if (!active) return;
        const images = Array.isArray(active.images) ? active.images : [];
        let body = ensureMediaPlaceholders(String(active.body || ""), active.tables || [], images);
        body = appendBodyLine(body, "{{TBL}}");
        patchNode(active._key, {
            tables: [...(active.tables || []), [["", ""], ["", ""]]],
            table_captions: [...(Array.isArray(active.table_captions) ? active.table_captions : []), ""],
            body,
        });
    };
    const delTable = (ti: number) => patchNode(active._key, {
        tables: (active.tables || []).filter((_: any, i: number) => i !== ti),
        table_captions: (Array.isArray(active.table_captions) ? active.table_captions : []).filter((_: any, i: number) => i !== ti),
    });
    const setCaption = (ti: number, val: string) => {
        const caps = Array.isArray(active.table_captions) ? [...active.table_captions] : [];
        while (caps.length <= ti) caps.push("");
        caps[ti] = val;
        patchNode(active._key, { table_captions: caps });
    };

    const chapterState = () => ({
        body: String(active?.body || ""),
        tables: active?.tables || [],
        images: Array.isArray(active?.images) ? active.images : [],
    });
    const addBodyBlock = () => {
        if (!active) return;
        const next = freeAddBodyBlock(chapterState());
        patchNode(data.activeKey, { body: next.body });
    };
    const placeAbove = (kind: "body" | "image" | "table", dataUrl?: string) => {
        if (!active) return;
        const next = freePlaceAbove(chapterState(), kind, dataUrl);
        patchNode(data.activeKey, { tables: next.tables, body: next.body, images: next.images });
        if (kind === "image") message.success("图片已更新，请保存文档");
    };
    const aboveBar = active && !readonly && chapterAllowsAboveTable(active) && (active.tables || []).length > 0 ? (
        <FreeSideActions
            label="上方添加正文"
            onBody={() => placeAbove("body")}
            onImageData={(url) => placeAbove("image", url)}
            onTable={() => placeAbove("table")}
        />
    ) : null;
    const uploadImage = (file: File, replaceIndex?: number) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (!active) return;
            const dataUrl = String(reader.result || "");
            const next = replaceIndex !== undefined && replaceIndex >= 0
                ? freeReplaceImage(chapterState(), replaceIndex, dataUrl)
                : freeAddImage(chapterState(), dataUrl);
            patchNode(data.activeKey, { images: next.images, body: next.body });
            message.success("图片已更新，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };
    const delImage = (index: number) => {
        if (!active) return;
        const next = freeDelImage(chapterState(), index);
        patchNode(data.activeKey, { images: next.images, body: next.body });
    };

    // 从「产品参与人员」按当前产品拉取全部人员，填入人员资源表（编号/姓名/所属部门/角色）
    const pullPersonnel = () => {
        const prodId = data.doc.product_id;
        if (!prodId) {
            message.warning("缺少产品信息，无法获取");
            return;
        }
        dispatch({ pulling: true });
        ApiMember.list_project_member({ prod_id: prodId, page_index: 0, page_size: 1000 }).then((res: any) => {
            dispatch({ pulling: false });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "获取失败");
                return;
            }
            const rows = (res.data && res.data.rows) || [];
            if (!rows.length) {
                message.info("该产品在「产品参与人员」中暂无数据");
                return;
            }
            const DEFAULT_HEADER = ["编号", "姓名", "所属部门", "角色"];
            const cur = Array.isArray(active.tables?.[0]) ? active.tables[0] : [DEFAULT_HEADER];
            const header = Array.isArray(cur[0]) && cur[0].length === 4 ? cur[0] : DEFAULT_HEADER;
            const norm = (s: any) => String(s || "").trim();
            // 保留已填「所属部门」（按姓名匹配）
            const deptByName: Record<string, string> = {};
            cur.slice(1).forEach((r: any[]) => {
                const nm = norm(r[1]);
                if (nm) deptByName[nm] = norm(r[2]);
            });
            const sorted = [...rows].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
            const bodyRows = sorted.map((m: any, i: number) => [
                String(i + 1),
                norm(m.name),
                deptByName[norm(m.name)] || norm(m.note),
                norm(m.role),
            ]);
            updateTables([[header, ...bodyRows]]);
            message.success(`已获取 ${bodyRows.length} 人`);
        }).catch(() => {
            dispatch({ pulling: false });
            message.error("获取失败");
        });
    };

    const findTestItems = (nodes: any[]): any => {
        for (const n of nodes || []) {
            if (stripNum(n.title).includes("测试项列表") || n.ref_type === "test_items") return n;
            const hit = findTestItems(n.children || []);
            if (hit) return hit;
        }
        return null;
    };

    const pullTestItems = () => {
        if (readonly || !active || !showTestItemPull(active)) return;
        const product_id = data.doc?.product_id;
        if (!product_id) {
            message.warning("请先选择产品");
            return;
        }
        const stage = stripNum(active.title);
        dispatch({ pulling: true });
        Api.refill_str_test_items({ product_id, stages: stage })
            .then((res: any) => {
                dispatch({ pulling: false });
                if (res.code !== Api.C_OK) {
                    message.error(res.msg || "获取失败");
                    return;
                }
                const items = res.data?.items || [];
                const item = items.find((it: any) => it.title === stage) || items[0];
                if (!item || !(item.row_count > 0)) {
                    message.warning("该产品暂无对应阶段测试用例");
                    return;
                }
                setSections(applyTestItemFill(data.sections, active._key, item.tables || []));
                message.success(`已获取 ${item.row_count} 项`);
            })
            .catch(() => {
                dispatch({ pulling: false });
                message.error("获取失败");
            });
    };

    const pullCompatItems = () => {
        if (readonly || !active || !showCompatPull(active)) return;
        const product_id = data.doc?.product_id;
        if (!product_id) {
            message.warning("请先选择产品");
            return;
        }
        const kind = compatKindOf(active);
        if (!kind) return;
        dispatch({ pulling: true });
        Api.refill_str_compat_items({ product_id, kind })
            .then((res: any) => {
                dispatch({ pulling: false });
                if (res.code !== Api.C_OK) {
                    message.error(res.msg || "获取失败");
                    return;
                }
                const rows: any[][] = res.data?.rows || [];
                if (!rows.length) {
                    message.warning("该产品暂无 SRS 标准需求");
                    return;
                }
                const oldTb = (active.tables || [])[0] || [];
                let hi = 0;
                while (
                    hi < oldTb.length &&
                    Array.isArray(oldTb[hi]) &&
                    String(oldTb[hi][0] || "").trim() === "测试模块"
                ) {
                    hi += 1;
                }
                const hdr = hi > 0 ? oldTb.slice(0, hi).map((r: any[]) => [...r]) : [["测试模块", "测试点", "结果", "结果"]];
                const cols = Math.max(...hdr.map((r: any[]) => (Array.isArray(r) ? r.length : 0)), 2);
                const dataRows = rows.map((r: any[]) => {
                    const next = [...(r || [])];
                    while (next.length < cols) next.push("通过");
                    return next.slice(0, cols);
                });
                patchNode(active._key, { tables: [[...hdr, ...dataRows]] });
                message.success(`已获取 ${res.data?.leaves?.length || 0} 个模块、${rows.length} 行测试点`);
            })
            .catch(() => {
                dispatch({ pulling: false });
                message.error("获取失败");
            });
    };

    const generateCharts = () => {
        if (stripNum(active.title).includes("缺陷统计")) {
            const grid = (active.tables || [])[0] || [];
            if (grid.length < 2) { message.warning("没有缺陷统计数据"); return; }
            const header = grid[0].map((c: any) => String(c || ""));
            const chars = ["一", "二", "三", "四", "五"];
            const lvls = ["一级", "二级", "三级", "四级", "五级"];
            const lvlCol: Record<number, number> = {};
            header.forEach((h: string, ci: number) => { if (ci >= 2) chars.forEach((ch, idx) => { if (h.includes(ch)) lvlCol[idx] = ci; }); });
            const idxs = lvls.map((_, i) => i).filter((i) => lvlCol[i] !== undefined);
            const rowOf = (kw: string) => (grid.find((r: any[]) => String(r[0] || "").startsWith(kw)) || []);
            const valOf = (kw: string, i: number) => parseInt(String(rowOf(kw)[lvlCol[i]] || "0").replace(/[^0-9]/g, ""), 10) || 0;
            const caseTotal = String(rowOf("用例总数")[1] || "").replace(/[^0-9]/g, "");
            const cats = ["Bug总数", "已解决Bug数", "遗留Bug数"];
            const resolvedTotal = idxs.reduce((a: number, i: number) => a + valOf("已解决", i), 0);
            const shown = idxs.filter((i) => valOf("Bug总数", i) || valOf("遗留", i));
            const series = shown.map((i, k) => ({
                name: `${lvls[i]}Bug`, stack: "defect",
                data: [valOf("Bug总数", i), k === 0 ? resolvedTotal : 0, valOf("遗留", i)],
            }));
            dispatch({ charting: true });
            try {
                const url = buildBarChartUrl(caseTotal ? `用例总数：${caseTotal}` : "缺陷统计分析", cats, series);
                patchNode(active._key, { charts: [url] });
                message.success("已生成缺陷统计图");
            } catch (_e) { message.error("生成失败"); } finally { dispatch({ charting: false }); }
            return;
        }
        const ti = findTestItems(data.sections);
        if (!ti || !(ti.children || []).length) { message.warning("没有测试项数据，无法生成分布图"); return; }
        dispatch({ charting: true });
        try {
            const charts: string[] = [];
            (ti.children || []).forEach((stage: any) => {
                const grid = ((stage.tables || [])[0]) || [];
                if (grid.length < 2) return;
                const header = grid[0].map((c: any) => String(c || ""));
                const ciF = header.findIndex((h: string) => h.includes("功能点"));
                const ciN = header.findIndex((h: string) => h.includes("用例个数"));
                const ciP = header.findIndex((h: string) => h.includes("是否通过"));
                const funcs: string[] = [], counts: number[] = [], flags: number[] = [];
                grid.slice(1).forEach((r: any[]) => {
                    funcs.push(String(r[ciF] || ""));
                    counts.push(parseInt(String(r[ciN] || "0").replace(/[^0-9]/g, ""), 10) || 0);
                    const pv = String(r[ciP] || "");
                    flags.push(pv.includes("是") || pv.includes("通过") || !pv.trim() ? 0 : 1);
                });
                charts.push(buildChartUrl(`${stripNum(stage.title)}记录`, funcs, counts, flags));
            });
            patchNode(active._key, { charts });
            message.success(`已生成 ${charts.length} 张分布图`);
        } catch (_e) {
            message.error("生成失败");
        } finally {
            dispatch({ charting: false });
        }
    };

    const removeChart = (i: number) => {
        const charts = (active.charts || []).filter((_: any, idx: number) => idx !== i);
        patchNode(active._key, { charts });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_str_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async (mode: string = "full") => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_str_doc({ id, mode });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const numbers = computeNumbers(data.sections);

    const renderNav = (nodes: any[], depth: number) =>
        (nodes || []).map((n: any, i: number) => {
            const num = numbers[n._key];
            const label = `${num ? num + " " : ""}${stripNum(n.title) || "(未命名)"}`;
            const sibs = nodes || [];
            return (
            <div key={n._key}>
                <div
                    className={`pdp-nav-item${n._key === data.activeKey ? " active" : ""}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => dispatch({ activeKey: n._key })}>
                    <span className="pdp-nav-title" title={label}>{label}</span>
                    {!readonly && (
                        <span className="pdp-nav-ops" onClick={(e) => e.stopPropagation()}>
                            <span className="pdp-nav-move">
                                {i > 0 && <ArrowUpOutlined title="上移" onClick={() => moveNode(n._key, -1)} />}
                                {i < sibs.length - 1 && <ArrowDownOutlined title="下移" onClick={() => moveNode(n._key, 1)} />}
                            </span>
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
                                onChange={(e) => {
                                    const version = e.target.value;
                                    dispatch({
                                        doc: { ...data.doc, version },
                                        sections: syncDocVersionFields(data.sections, version),
                                    });
                                }}
                            />
                        </span>
                </div>}
                <Space>
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    )}
                    <Button loading={data.exporting} onClick={() => doExport("main")}>导出软件测试报告</Button>
                    <Button loading={data.exporting} onClick={() => doExport("compat")}>导出软件测试报告-兼容性测试</Button>
                    <Button onClick={() => navigate("/str_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；悬停或选中时显示 ↑↓ 同级上下移；编号按层级自动生成</div>
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
                                        placeholder="只填名称，如：开发方法"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })}
                                    />
                                </div>
                                {(() => {
                                    const images: string[] = Array.isArray(active.images) ? active.images : [];
                                    const segments = buildFreeSegments(String(active.body || ""), active.tables || [], images);
                                    const hasInterleave = shouldUseFreeInterleave(String(active.body || ""), segments, { skip: active.ref_type === "review" });
                                    if (hasInterleave) {
                                        return (
                                            <>
                                                {(active.ref_type === "personnel" || stripNum(active.title) === "人员资源") && !readonly && (
                                                    <div className="pdp-pull-bar">
                                                        <Button type="primary" ghost loading={data.pulling} onClick={pullPersonnel}>
                                                            从产品参与人员获取
                                                        </Button>
                                                        <span className="pdp-pull-hint">
                                                            按当前产品{data.doc.product_full_version ? `（${data.doc.product_full_version}）` : ""}从「产品参与人员」同步全部人员（编号/姓名/角色，保留已填所属部门）
                                                        </span>
                                                    </div>
                                                )}
                                                {!readonly && showTestItemPull(active) && (
                                                    <div className="pdp-pull-bar">
                                                        <Button type="primary" ghost loading={data.pulling} onClick={pullTestItems}>
                                                            自动获取
                                                        </Button>
                                                        <span className="pdp-pull-hint">
                                                            从该产品已上传的「{stripNum(active.title)}」测试用例拉取测试项列表
                                                        </span>
                                                    </div>
                                                )}
                                                {!readonly && showCompatPull(active) && (
                                                    <div className="pdp-pull-bar">
                                                        <Button type="primary" ghost loading={data.pulling} onClick={pullCompatItems}>
                                                            自动获取
                                                        </Button>
                                                        <span className="pdp-pull-hint">
                                                            从该产品 SRS 需求自动填充测试模块，并按模板补全测试点
                                                        </span>
                                                    </div>
                                                )}
                                                {(stripNum(active.title).includes("分布图") || stripNum(active.title).includes("缺陷统计")) && (
                                                    <>
                                                        {!readonly && (
                                                            <div className="pdp-pull-bar">
                                                                <Button type="primary" ghost loading={data.charting} onClick={generateCharts}>
                                                                    生成分布图
                                                                </Button>
                                                                <span className="pdp-pull-hint">按测试项列表（各阶段用例个数）生成折线图，导出 Word 自动内嵌</span>
                                                            </div>
                                                        )}
                                                        {(active.charts || []).map((url: string, i: number) => (
                                                            <div className="pdp-field" key={i}>
                                                                <img src={url} style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                                {!readonly && (
                                                                    <DeleteOutlined title="删除此图" style={{ color: "#c00", cursor: "pointer", marginLeft: 8 }} onClick={() => removeChart(i)} />
                                                                )}
                                                            </div>
                                                        ))}
                                                    </>
                                                )}
                                                {segments.map((seg, si) => {
                                                    if (seg.type === "text") {
                                                        return (
                                                            <div className="pdp-field" key={si}>
                                                                <div className="pdp-label">正文 {segments.slice(0, si + 1).filter((s: any) => s.type === "text").length}</div>
                                                                <Input.TextArea
                                                                    autoSize={{ minRows: 3, maxRows: 20 }}
                                                                    value={seg.text}
                                                                    disabled={readonly}
                                                                    placeholder="本段正文内容，可多行"
                                                                    onChange={(e) => {
                                                                        const newBody = reassembleFreeBody(segments, si, e.target.value);
                                                                        patchNode(active._key, { body: newBody });
                                                                    }}
                                                                />
                                                            </div>
                                                        );
                                                    }
                                                    if (seg.type === "image") {
                                                        const ii = seg.imageIndex;
                                                        const url = images[ii];
                                                        if (!url) return null;
                                                        return (
                                                            <div key={si} style={{ margin: "8px 0", textAlign: "center" }}>
                                                                <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                                {!readonly && (
                                                                    <Space size={4} style={{ marginTop: 4, display: "flex", justifyContent: "center" }}>
                                                                        <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadImage(file as File, ii)}>
                                                                            <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                                                        </Upload>
                                                                        <Button size="small" danger onClick={() => delImage(ii)}>删除</Button>
                                                                    </Space>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    const ti = seg.tableIndex;
                                                    const tb = (active.tables || [])[ti];
                                                    if (!tb) return null;
                                                    const mg = compatMerge(tb);
                                                    const us = unitItemSpans(tb);
                                                    return (
                                                        <div className="pdp-table-block" key={si}>
                                                    {si === segments.findIndex((s: any) => s.type === "table") ? aboveBar : null}
                                                            <div className="pdp-table-bar">
                                                                <span className="pdp-label">表格 {ti + 1}</span>
                                                                {!readonly && (
                                                                    <Space size={4}>
                                                                        <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                                        <Button size="small" disabled={(tb[0] || []).length <= 1} onClick={() => delCol(ti, (tb[0] || []).length - 1)}>－列</Button>
                                                                        <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                                    </Space>
                                                                )}
                                                            </div>
                                                            <Input.TextArea
                                                                autoSize={{ minRows: 1, maxRows: 6 }}
                                                                value={(active.table_captions && active.table_captions[ti]) || ""}
                                                                disabled={readonly}
                                                                placeholder="表格上方说明/表名（显示在此表上方，可空）"
                                                                style={{ marginBottom: 6, fontSize: 13 }}
                                                                onChange={(e) => setCaption(ti, e.target.value)}
                                                            />
                                                            <table className="pdp-grid" style={{ tableLayout: isEquipInfoTable(tb) ? "auto" : "fixed", width: "100%" }}>
                                                                {tb[0] && (
                                                                    <colgroup>
                                                                        {tb[0].map((h: any, ci: number) => (
                                                                            <col key={ci} style={String(h || "").includes("设备信息") ? { width: "62%" } : undefined} />
                                                                        ))}
                                                                        {!readonly && <col style={{ width: 72 }} />}
                                                                    </colgroup>
                                                                )}
                                                                <tbody>
                                                                    {tb.map((row: any[], r: number) => (
                                                                        <tr key={r}>
                                                                            {row.map((cell: any, ci: number) => {
                                                                                const sp = tableCellSpan(tb, mg, us, r, ci);
                                                                                if (sp.skip) return null;
                                                                                return (
                                                                                <td key={ci} rowSpan={sp.rowSpan} colSpan={sp.colSpan} className={r === 0 ? "head" : ""} style={(sp.rowSpan && sp.rowSpan > 1) || (sp.colSpan && sp.colSpan > 1) ? { verticalAlign: "middle", textAlign: sp.colSpan && sp.colSpan > 1 ? "center" : undefined } : undefined}>
                                                                                    {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                        <span style={{ position: "relative", display: "inline-block" }}>
                                                                                            <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                                            {!readonly && (
                                                                                                <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                                                                                            )}
                                                                                        </span>
                                                                                    ) : (
                                                                                        <Input.TextArea
                                                                                            className="pdp-cell"
                                                                                            autoSize={cellAutoSize(tb, ci, cell)}
                                                                                            value={cell ?? ""}
                                                                                            disabled={readonly}
                                                                                            style={String((tb[0] || [])[ci] || "").includes("设备信息") ? { whiteSpace: "pre-wrap" } : undefined}
                                                                                            onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                                        />
                                                                                    )}
                                                                                </td>
                                                                                );
                                                                            })}
                                                                            {!readonly && (
                                                                                <td className="pdp-row-op" style={{ width: 72, whiteSpace: "nowrap", verticalAlign: "middle" }}>
                                                                                    <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(ti, r)} />
                                                                                    {tb.length > 1 && (
                                                                                        <Button type="link" danger size="small" onClick={() => delRow(ti, r)}>删除</Button>
                                                                                    )}
                                                                                </td>
                                                                            )}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    );
                                                })}
                                                {!readonly && active.ref_type !== "review" && chapterAllowsAboveTable(active) && (
                                                    <FreeSideActions
                                                        label={(active.tables || []).length ? "下方添加正文" : "添加正文"}
                                                        onBody={addBodyBlock}
                                                        onImageData={(url) => {
                                                            const next = freeAddImage(chapterState(), url);
                                                            patchNode(data.activeKey, { images: next.images, body: next.body });
                                                            message.success("图片已更新，请保存文档");
                                                        }}
                                                        onTable={addTable}
                                                    />
                                                )}
                                                {active.body_tail !== undefined && active.body_tail !== null && active.body_tail !== "" && (
                                                    <div className="pdp-field">
                                                        <div className="pdp-label">表格后正文</div>
                                                        <Input.TextArea
                                                            autoSize={{ minRows: 1, maxRows: 12 }}
                                                            value={active.body_tail ?? ""}
                                                            disabled={readonly}
                                                            placeholder="最后一张表之后的正文（可空）"
                                                            onChange={(e) => patchNode(active._key, { body_tail: e.target.value })}
                                                        />
                                                    </div>
                                                )}
                                            </>
                                        );
                                    }
                                    return (
                                        <>
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
                                            {(active.ref_type === "personnel" || stripNum(active.title) === "人员资源") && !readonly && (
                                                <div className="pdp-pull-bar">
                                                    <Button type="primary" ghost loading={data.pulling} onClick={pullPersonnel}>
                                                        从产品参与人员获取
                                                    </Button>
                                                    <span className="pdp-pull-hint">
                                                        按当前产品{data.doc.product_full_version ? `（${data.doc.product_full_version}）` : ""}从「产品参与人员」同步全部人员（编号/姓名/角色，保留已填所属部门）
                                                    </span>
                                                </div>
                                            )}
                                            {!readonly && showTestItemPull(active) && (
                                                <div className="pdp-pull-bar">
                                                    <Button type="primary" ghost loading={data.pulling} onClick={pullTestItems}>
                                                        自动获取
                                                    </Button>
                                                    <span className="pdp-pull-hint">
                                                        从该产品已上传的「{stripNum(active.title)}」测试用例拉取测试项列表
                                                    </span>
                                                </div>
                                            )}
                                            {!readonly && showCompatPull(active) && (
                                                <div className="pdp-pull-bar">
                                                    <Button type="primary" ghost loading={data.pulling} onClick={pullCompatItems}>
                                                        自动获取
                                                    </Button>
                                                    <span className="pdp-pull-hint">
                                                        从该产品 SRS 需求自动填充测试模块，并按模板补全测试点
                                                    </span>
                                                </div>
                                            )}
                                            {(stripNum(active.title).includes("分布图") || stripNum(active.title).includes("缺陷统计")) && (
                                                <>
                                                    {!readonly && (
                                                        <div className="pdp-pull-bar">
                                                            <Button type="primary" ghost loading={data.charting} onClick={generateCharts}>
                                                                生成分布图
                                                            </Button>
                                                            <span className="pdp-pull-hint">按测试项列表（各阶段用例个数）生成折线图，导出 Word 自动内嵌</span>
                                                        </div>
                                                    )}
                                                    {(active.charts || []).map((url: string, i: number) => (
                                                        <div className="pdp-field" key={i}>
                                                            <img src={url} style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                            {!readonly && (
                                                                <DeleteOutlined title="删除此图" style={{ color: "#c00", cursor: "pointer", marginLeft: 8 }} onClick={() => removeChart(i)} />
                                                            )}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                            {aboveBar}
                                            {active.ref_type === "review"
                                                ? (
                                                    <ReviewRecordTables tables={active.tables || []} readonly={readonly} onChange={updateTables} />
                                                )
                                                : (active.tables || []).map((tb: any[], ti: number) => {
                                                const mg = compatMerge(tb);
                                                const us = unitItemSpans(tb);
                                                return (
                                                <div className="pdp-table-block" key={ti}>
                                                    <div className="pdp-table-bar">
                                                        <span className="pdp-label">表格 {ti + 1}</span>
                                                        {!readonly && (
                                                            <Space size={4}>
                                                                <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                                <Button size="small" disabled={(tb[0] || []).length <= 1} onClick={() => delCol(ti, (tb[0] || []).length - 1)}>－列</Button>
                                                                <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                            </Space>
                                                        )}
                                                    </div>
                                                    <Input.TextArea
                                                        autoSize={{ minRows: 1, maxRows: 6 }}
                                                        value={(active.table_captions && active.table_captions[ti]) || ""}
                                                        disabled={readonly}
                                                        placeholder="表格上方说明/表名（显示在此表上方，可空）"
                                                        style={{ marginBottom: 6, fontSize: 13 }}
                                                        onChange={(e) => setCaption(ti, e.target.value)}
                                                    />
                                                    <table className="pdp-grid" style={{ tableLayout: isEquipInfoTable(tb) ? "auto" : "fixed", width: "100%" }}>
                                                        {tb[0] && (
                                                            <colgroup>
                                                                {tb[0].map((h: any, ci: number) => (
                                                                    <col key={ci} style={String(h || "").includes("设备信息") ? { width: "62%" } : undefined} />
                                                                ))}
                                                                {!readonly && <col style={{ width: 72 }} />}
                                                            </colgroup>
                                                        )}
                                                        <tbody>
                                                            {tb.map((row: any[], r: number) => (
                                                                <tr key={r}>
                                                                    {row.map((cell: any, ci: number) => {
                                                                        const sp = tableCellSpan(tb, mg, us, r, ci);
                                                                        if (sp.skip) return null;
                                                                        return (
                                                                        <td key={ci} rowSpan={sp.rowSpan} colSpan={sp.colSpan} className={r === 0 ? "head" : ""} style={(sp.rowSpan && sp.rowSpan > 1) || (sp.colSpan && sp.colSpan > 1) ? { verticalAlign: "middle", textAlign: sp.colSpan && sp.colSpan > 1 ? "center" : undefined } : undefined}>
                                                                            {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                <span style={{ position: "relative", display: "inline-block" }}>
                                                                                    <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                                    {!readonly && (
                                                                                        <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                                                                                    )}
                                                                                </span>
                                                                            ) : (
                                                                                <Input.TextArea
                                                                                    className="pdp-cell"
                                                                                    autoSize={cellAutoSize(tb, ci, cell)}
                                                                                    value={cell ?? ""}
                                                                                    disabled={readonly}
                                                                                    style={String((tb[0] || [])[ci] || "").includes("设备信息") ? { whiteSpace: "pre-wrap" } : undefined}
                                                                                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                                />
                                                                            )}
                                                                        </td>
                                                                        );
                                                                    })}
                                                                    {!readonly && (
                                                                        <td className="pdp-row-op" style={{ width: 72, whiteSpace: "nowrap", verticalAlign: "middle" }}>
                                                                            <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(ti, r)} />
                                                                            {tb.length > 1 && (
                                                                                <Button type="link" danger size="small" onClick={() => delRow(ti, r)}>删除</Button>
                                                                            )}
                                                                        </td>
                                                                    )}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                );
                                            })}

                                            {!readonly && active.ref_type !== "review" && (
                                                <>
                                                <Space wrap style={{ margin: "8px 0" }}>
                                                    <Button size="small" onClick={addBodyBlock}>{(active.tables || []).length ? "下方添加正文" : "添加正文"}</Button>
                                                    <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadImage(file as File)}>
                                                        <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
                                                    </Upload>
                                                </Space>
                                            <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>
                                                    添加表格
                                                </Button>
                                                </>
                                            )}

                                            {active.ref_type !== "review" && (active.tables || []).length > 0 && (
                                                <div className="pdp-field">
                                                    <div className="pdp-label">表格后正文</div>
                                                    <Input.TextArea
                                                        autoSize={{ minRows: 1, maxRows: 12 }}
                                                        value={active.body_tail ?? ""}
                                                        disabled={readonly}
                                                        placeholder="最后一张表之后的正文（可空）"
                                                        onChange={(e) => patchNode(active._key, { body_tail: e.target.value })}
                                                    />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
