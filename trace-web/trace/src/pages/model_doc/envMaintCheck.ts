import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import { C_OK } from "@/api/http";

/** 模型说明里的周检表：分组与开发文件 DEM / 测试文件 TEM 一致。 */

export type EnvCheckKind = "server" | "dev";
export type EnvAsset = { code: string; usage: string };
type Group = { label: string; leaves: string[] };
type LeafCol = { label: string; type: "date" | "check" | "problem" | "checker" };

const SERVER_DEV: Group[] = [
    { label: "日期", leaves: [] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "数据库\n运行是否正常", "应用服务\n运行是否正常"] },
    { label: "开发环境\n是否更新升级", leaves: [] },
    { label: "服务器\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "开发工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "服务器\n是否备份", leaves: [] },
    { label: "服务器\n日志是否错误", leaves: [] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const DEV_DEV: Group[] = [
    { label: "日期", leaves: [] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "浏览器\n运行是否正常"] },
    { label: "开发环境\n是否更新升级", leaves: [] },
    { label: "开发机\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "开发工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const SERVER_TEST: Group[] = [
    { label: "日期", leaves: [] },
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
const DEV_TEST: Group[] = [
    { label: "日期", leaves: [] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "浏览器\n运行是否正常"] },
    { label: "测试环境\n是否更新升级", leaves: [] },
    { label: "测试机\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "测试工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const SERVER_ANNO: Group[] = [
    { label: "日期", leaves: [] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "数据库\n运行是否正常", "应用服务\n运行是否正常"] },
    { label: "标注环境\n是否更新升级", leaves: [] },
    { label: "服务器\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "标注工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "服务器\n是否备份", leaves: [] },
    { label: "服务器\n日志是否错误", leaves: [] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];
const DEV_ANNO: Group[] = [
    { label: "日期", leaves: [] },
    { label: "硬件环境", leaves: ["CPU", "GPU", "内存", "网卡"] },
    { label: "软件环境", leaves: ["操作系统\n运行是否正常", "浏览器\n运行是否正常"] },
    { label: "标注环境\n是否更新升级", leaves: [] },
    { label: "标注机\n是否杀毒", leaves: [] },
    { label: "网络环境\n是否正常", leaves: [] },
    { label: "标注工具", leaves: ["是否正常运行", "是否更新升级"] },
    { label: "出现的问题及处理方式", leaves: [] },
    { label: "检查人", leaves: [] },
];

export const envCheckGroups = (docType: string, kind: EnvCheckKind): Group[] => {
    if (docType === "md_020") return kind === "server" ? SERVER_TEST : DEV_TEST;
    if (docType === "dd_017") return kind === "server" ? SERVER_ANNO : DEV_ANNO;
    return kind === "server" ? SERVER_DEV : DEV_DEV;
};

export const envCheckKind = (usage: string): EnvCheckKind =>
    String(usage || "").includes("共用") ? "server" : "dev";

export const envCheckTitle = (docType: string, kind: EnvCheckKind, code: string): string => {
    if (docType === "md_020") {
        return `测试共用-${kind === "server" ? "服务器" : "测试机"}检查表（${code}）`;
    }
    if (docType === "dd_017") {
        return `标注共用-${kind === "server" ? "服务器" : "标注机"}检查表（${code}）`;
    }
    return `开发共用-${kind === "server" ? "服务器" : "开发机"}检查表（${code}）`;
};

export const envCheckLeafCols = (docType: string, kind: EnvCheckKind): LeafCol[] => {
    const out: LeafCol[] = [];
    envCheckGroups(docType, kind).forEach((g) => {
        if (g.leaves.length) {
            g.leaves.forEach((lf) => out.push({ label: lf, type: "check" }));
        } else {
            const t = g.label === "日期" ? "date"
                : g.label.startsWith("出现的问题") ? "problem"
                    : g.label === "检查人" ? "checker" : "check";
            out.push({ label: g.label, type: t });
        }
    });
    return out;
};

export const envCheckDefaults = (docType: string, kind: EnvCheckKind): string[] =>
    envCheckLeafCols(docType, kind)
        .filter((c) => c.type === "check")
        .map((c) => ((c.label.includes("更新升级") || c.label.includes("日志是否错误")) ? "否" : "是"));

export const isEnvCheckGrid = (tb: any[]): boolean =>
    Array.isArray(tb) && Array.isArray(tb[0]) && String(tb[0][0] || "").trim() === "env_check";

const pad2 = (n: number) => String(n).padStart(2, "0");

const utcOf = (r: any) => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const y = num(r.year);
    const m = num(r.month);
    const d = num(r.day) || 1;
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12 || d < 1) return null;
    return Date.UTC(y, m - 1, d);
};

const weekRanges = (start: number, end: number): string[] => {
    if (start > end) return [];
    const fmt = (ms: number) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())}`;
    };
    const ranges: string[] = [];
    const startDay = new Date(start).getUTCDay();
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
    let cur = start + mondayOffset * 86400000;
    while (cur <= end) {
        const monday = cur;
        const friday = monday + 4 * 86400000;
        const ws = Math.max(monday, start);
        let we = Math.min(friday, end);
        const wsDay = new Date(ws).getUTCDay();
        if (wsDay === 0 || wsDay === 6) {
            cur = monday + 7 * 86400000;
            continue;
        }
        const weDay = new Date(we).getUTCDay();
        if (weDay === 0 || weDay === 6) we = friday;
        if (ws <= we) ranges.push(`${fmt(ws)}- ${fmt(we)}`);
        cur = monday + 7 * 86400000;
    }
    return ranges;
};

const hasDateRow = (rows: any[]) => (rows || []).some((r: any) => (r.row_type || "date") === "date" && utcOf(r) != null);

/** 当前版本没有日期行时，用同一产品名称下已有时间线的版本（id 从新到旧）。 */
export const loadEnvTimelineRows = async (productId: number, productName: string): Promise<any[]> => {
    const read = async (id: number) => {
        const tl: any = await ApiTimeline.list_timeline({ prod_id: id }).catch(() => null);
        return tl && tl.code === C_OK ? ((tl.data && tl.data.rows) || []) : [];
    };
    const first = await read(productId);
    if (hasDateRow(first) || !String(productName || "").trim()) return first;
    const list: any = await ApiProduct.list_product({ page_size: 10000 }).catch(() => null);
    const siblings = (list && list.code === C_OK ? ((list.data && list.data.rows) || []) : [])
        .filter((p: any) => String(p.name || "").trim() === String(productName).trim() && p.id !== productId)
        .sort((a: any, b: any) => Number(b.id) - Number(a.id));
    for (const s of siblings) {
        const rows = await read(s.id);
        if (hasDateRow(rows)) return rows;
    }
    return first;
};

const deptDates = (rows: any[], dept: string, pred: (text: string) => boolean): number[] => {
    const out: number[] = [];
    (rows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const dt = utcOf(r);
        if (dt == null) return;
        if (pred(String((r.cells || {})[dept] || ""))) out.push(dt);
    });
    return out;
};

const spanWeeks = (starts: number[], ends: number[]): string[] => {
    if (!starts.length || !ends.length) return [];
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    if (start > end) return [];
    return weekRanges(start, end);
};

/** 模型开发：模型配置管理计划 → 追溯。模型测试：模型测试（不含方案）→ 追溯。都看「模型部」。 */
export const computeModelEnvWeeks = (rows: any[], docType: string): string[] => {
    const starts = deptDates(rows, "模型部", (text) => (
        docType === "md_020"
            ? /模型测试(?!方案)/.test(text)
            : text.includes("模型配置管理计划") || text.includes("模型配置计划")
    ));
    const ends = deptDates(rows, "模型部", (text) => text.includes("追溯"));
    return spanWeeks(starts, ends);
};

/** 数据开发/标注环境：数据试标注记录 → 数据库维护记录。都看「数据部」。 */
export const computeDataEnvWeeks = (rows: any[], _docType: string): string[] => {
    const starts = deptDates(rows, "数据部", (text) => text.includes("试标注记录"));
    const ends = deptDates(rows, "数据部", (text) => text.includes("数据库维护记录"));
    return spanWeeks(starts, ends);
};

const assetCellText = (v: any): string => String(v ?? "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 资产表「产品名称」「完整版本」列号。表头对不上时用第 3、4 列。 */
const assetNameVersionCols = (rows: any[][]): number[] => {
    const header = (Array.isArray(rows?.[0]) ? rows[0] : []).map((c: any) => assetCellText(c));
    const cols = [header.indexOf("产品名称"), header.indexOf("完整版本")].filter((i) => i >= 0);
    return cols.length ? cols : [2, 3];
};

/** 资产表产品名称、完整版本：连续相同非空格纵向合并。 */
export const assetNameVersionSpan = (rows: any[][], r: number, c: number): { skip: boolean; rowSpan: number } => {
    if (r <= 0 || !assetNameVersionCols(rows).includes(c)) return { skip: false, rowSpan: 1 };
    const val = assetCellText(rows[r]?.[c]);
    if (!val) return { skip: false, rowSpan: 1 };
    if (r > 1 && assetCellText(rows[r - 1]?.[c]) === val) return { skip: true, rowSpan: 1 };
    let span = 1;
    for (let i = r + 1; i < rows.length; i++) {
        if (assetCellText(rows[i]?.[c]) !== val) break;
        span += 1;
    }
    return { skip: false, rowSpan: span };
};

const DEVICE_INFO_BLANK = "操作系统：\n内存：\nCPU：\n硬盘：\n存储盘：\nGPU：\nGPU显存：";
const DEVICE_INFO_BY_DOC: Record<string, Record<string, string>> = {
    md_019: {
        ISER21070004: "操作系统：Ubuntu18.04 64位版本 \n内存：64GB\nCPU：Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz\n硬盘：256GB\n存储盘：10T\nGPU： RTX 4000 × 2\nGPU显存：8G",
        SER01391: "操作系统：Ubuntu18.04 64位版本 \n内存：64GB\nCPU：Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz\n硬盘：256GB\n存储盘：10T\nGPU：GeForce GTX 2070× 2\nGPU显存：8G",
        SER01172: "操作系统：Ubuntu18.04 64位版本\n内存：32 GB\nCPU：Intel® Core™ i7-9700K CPU @ 3.60GHz × 8\n硬盘：250GB\n存储盘：3T\nGPU：GeForce RTX 2070 × 2\nGPU显存：8G",
    },
    md_020: {
        SER01101: "操作系统: Ubuntu 18.04 64位版本\n内存: 32G\nCPU: Intel(R) Core(TM) i7-6850K CPU @ 3.60GHz\n硬盘: 1T\n存储盘: 8T\nGPU: GTX 1080Ti× 2\nGPU显存: 11G",
        SER01201: "操作系统：Ubuntu18.04 LTS 64位版本\n内存：64G\nCPU：Intel® Core™ i7-8700K CPU @ 3.70GHz × 12 \n硬盘：256GB\n存储盘：12T\nGPU：GeForce 1080\nGPU显存：8G",
    },
    dd_016: {
        SER01256: "操作系统：Ubuntu18.04 LTS 64位版本\n内存：32 GiB\nCPU：Intel® Core™ i7-8700K CPU @ 3.50GHz × 12 \n硬盘：250GB\n存储盘：20T\nGPU：GeForce 1080\nGPU显存：8G",
        SER01201: "操作系统：Ubuntu18.04 LTS 64位版本\n内存：32 GiB\nCPU：Intel® Core™ i7-8700K CPU @ 3.70GHz × 12 \n硬盘：250GB\n存储盘：12T\nGPU：GeForce 1080\nGPU显存：8G",
    },
    dd_017: {
        SER01020: "操作系统：Windows 10的64位版本\n内存：32 GiB\nCPU：Intel® Core™ i7-6850K CPU @ 3.60GHz × 12 \n硬盘：250GB\n存储盘：无\nGPU：GeForce 1080\nGPU显存：8G",
        SER01636: "操作系统：Windows 10的64位版本\n内存：32 GiB\nCPU：Intel® Core™ i7-6850K CPU @ 3.60GHz × 12 \n硬盘：250GB\n存储盘：无\nGPU：GeForce 1080\nGPU显存：8G",
    },
};

/** 设备信息为空时的默认配置。本类型原表优先，没有则用其它环境原表里同编码的配置。 */
export const defaultDeviceInfo = (code: string, docType?: string): string => {
    const c = String(code || "").trim();
    const own = docType ? DEVICE_INFO_BY_DOC[docType]?.[c] : "";
    if (own) return own;
    for (const bucket of Object.values(DEVICE_INFO_BY_DOC)) {
        if (bucket[c]) return bucket[c];
    }
    return DEVICE_INFO_BLANK;
};

export const parseEqAssets = (content: any, usageContains?: string): EnvAsset[] => {
    const out: EnvAsset[] = [];
    const seen = new Set<string>();
    const parseTable = (tb: any[]) => {
        if (!Array.isArray(tb)) return;
        let hi = -1;
        let brandI = -1;
        let codeI = -1;
        let nameI = -1;
        let usageI = -1;
        tb.forEach((row: any[], i: number) => {
            if (!Array.isArray(row) || hi >= 0) return;
            const cells = row.map((c: any) => String(c || "").trim());
            const b = cells.findIndex((c: string) => c === "品牌");
            const cidx = cells.findIndex((c: string) => c.includes("资产编码"));
            if (b >= 0 && cidx >= 0) {
                hi = i;
                brandI = b;
                codeI = cidx;
                nameI = cells.findIndex((c: string) => c === "名称");
                usageI = cells.findIndex((c: string) => c === "用途");
            }
        });
        if (hi < 0) return;
        tb.slice(hi + 1).forEach((row: any[]) => {
            if (!Array.isArray(row)) return;
            const brand = String(row[brandI] || "").trim();
            const code = String(row[codeI] || "").trim();
            const name = nameI >= 0 ? String(row[nameI] || "").trim() : "";
            const usage = usageI >= 0 ? String(row[usageI] || "").trim() : "";
            if (name === "显示器") return;
            if (usageContains && !usage.includes(usageContains)) return;
            if ((brand === "组装机" || brand === "Apple") && code && !seen.has(code)) {
                seen.add(code);
                out.push({ code, usage });
            }
        });
    };
    if (Array.isArray(content?.rows)) {
        parseTable(content.rows);
        return out;
    }
    const walk = (ns: any[]) => {
        (ns || []).forEach((n: any) => {
            (n.tables || []).forEach((tb: any[]) => parseTable(tb));
            walk(n.children || []);
        });
    };
    walk((content && content.sections) || []);
    return out;
};

export const collectAssetCodes = (nodes: any[]): EnvAsset[] => {
    const out: EnvAsset[] = [];
    const seen = new Set<string>();
    const walk = (ns: any[]) => {
        (ns || []).forEach((n: any) => {
            (n.tables || []).forEach((tb: any[]) => {
                if (!Array.isArray(tb) || !Array.isArray(tb[0])) return;
                const hdr = tb[0].map((h: any) => String(h || ""));
                if (String(hdr[0] || "").trim() !== "资产编码" || !hdr.some((h: string) => h.includes("设备信息"))) return;
                tb.slice(1).forEach((row: any[]) => {
                    if (!Array.isArray(row)) return;
                    const code = String(row[0] || "").trim();
                    if (code && !seen.has(code)) {
                        seen.add(code);
                        out.push({ code, usage: "" });
                    }
                });
            });
            walk(n.children || []);
        });
    };
    walk(nodes || []);
    return out;
};

export const buildEnvCheckTable = (
    docType: string,
    asset: EnvAsset,
    weeks: string[],
    checker: string,
    prev: Record<string, string[]>,
): any[][] => {
    const kind = envCheckKind(asset.usage);
    const defaults = envCheckDefaults(docType, kind);
    const rows: any[][] = [["env_check", kind, asset.code]];
    weeks.forEach((w) => {
        const old = prev[w] || [];
        const marks = defaults.map((d, i) => {
            const v = String(old[i + 1] || "").trim();
            return v === "是" || v === "否" ? v : d;
        });
        const problem = String(old[defaults.length + 1] || "").trim() || "无";
        rows.push([w, ...marks, problem, checker]);
    });
    return rows;
};

export const prevEnvCheckRows = (tb: any[]): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (!isEnvCheckGrid(tb)) return out;
    tb.slice(1).forEach((row: any[]) => {
        if (!Array.isArray(row) || !row[0]) return;
        out[String(row[0])] = row.map((c) => String(c ?? ""));
    });
    return out;
};
