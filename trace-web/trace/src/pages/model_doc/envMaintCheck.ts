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

export const computeDevTestWeeks = (rows: any[]): string[] => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const utcOf = (r: any) => {
        const y = num(r.year);
        const m = num(r.month);
        const d = num(r.day) || 1;
        if (isNaN(y) || isNaN(m) || m < 1 || m > 12 || d < 1) return null;
        return Date.UTC(y, m - 1, d);
    };
    const dev: number[] = [];
    const test: number[] = [];
    (rows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const dt = utcOf(r);
        if (dt == null) return;
        const vals = Object.values(r.cells || {});
        if (vals.some((v) => String(v || "").includes("产品开发") && !String(v || "").includes("计划"))) dev.push(dt);
        if (vals.some((v) => String(v || "").includes("测试"))) test.push(dt);
    });
    if (!dev.length || !test.length) return [];
    const start = Math.min(...dev);
    const end = Math.max(...test);
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
