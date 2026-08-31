import { Button, Checkbox, Input, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiModelDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiPersonSign from "@/api/ApiPersonSign";
import * as ApiProdDhf from "@/api/ApiProdDhf";
import * as ApiSrsDoc from "@/api/ApiSrsDoc";
import * as ApiSrsReq from "@/api/ApiSrsReq";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { getModelDocMeta } from "./ModelDocTypes";
import { computeGridSpans, computeCodeReviewSpans, isReviewRecordGrid, isCodeReviewChecklistGrid } from "./gridSpans";
import {
    buildEnvCheckTable, collectAssetCodes, computeDevTestWeeks, envCheckGroups, envCheckLeafCols,
    envCheckTitle, isEnvCheckGrid, parseEqAssets, prevEnvCheckRows,
} from "./envMaintCheck";
import "../pdp/PdpDocDetail.less";

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

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

const isModelDevOut = (val: any) => {
    const s = String(val || "");
    if (/模型开发(?!计划)/.test(s)) return true;
    if (s.includes("模型训练")) return true;
    if (/模型测试(?!方案)/.test(s)) return true;
    if (s.includes("模型封装") || s.includes("模型服务提交")) return true;
    return false;
};

const computeModelCycle = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const dates = (rows || [])
        .filter((r: any) => (r.row_type || "date") === "date" && isModelDevOut((r.cells || {})["模型部"]))
        .map((r: any) => ({ y: num(r.year), m: num(r.month), d: num(r.day) || 1 }))
        .filter((x: any) => !isNaN(x.y) && !isNaN(x.m) && x.m >= 1 && x.m <= 12);
    if (!dates.length) return "";
    const key = (x: any) => x.y * 10000 + x.m * 100 + x.d;
    let min = dates[0];
    let max = dates[0];
    dates.forEach((x: any) => { if (key(x) < key(min)) min = x; if (key(x) > key(max)) max = x; });
    const start = Date.UTC(min.y, min.m - 1, min.d);
    const end = Date.UTC(max.y, max.m - 1, max.d);
    const days = Math.round((end - start) / 86400000) + 1;
    return days > 0 ? `共用时约${days}天。` : "";
};


const fillModelCycle = (nodes: any[], text: string): any[] => {
    if (!text) return nodes;
    const fix = (n: any): any => {
        const isCycle = n.ref_type === "prod_cycle"
            || (stripNum(n.title) === "项目开发时间" && (n.children || []).length === 0);
        return { ...n, body: isCycle ? text : n.body, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
};

const memberNames = (members: any[], pred: (role: string) => boolean): string[] =>
    (members || []).map((m: any) => ({ role: String(m.role || "").trim(), name: String(m.name || "").trim() }))
        .filter((m) => m.name && pred(m.role))
        .map((m) => m.name);

const fillMd006People = (nodes: any[], members: any[]): any[] => {
    const staffDefs = [
        { pred: (r: string) => r === "模型部负责人" || r === "模型负责人", label: "模型部负责人" },
        { pred: (r: string) => r === "高级算法工程师", label: "高级算法工程师" },
        { pred: (r: string) => r === "算法工程师", label: "算法工程师" },
        { pred: (r: string) => r === "项目专员", label: "项目专员" },
    ];
    const staffRows: string[][] = [];
    staffDefs.forEach((d) => {
        memberNames(members, d.pred).forEach((name) => {
            staffRows.push([String(staffRows.length + 1), name, "模型部", d.label]);
        });
    });
    const pm = memberNames(members, (r) => r.includes("产品经理"))[0] || "";
    const testers = memberNames(members, (r) => r === "项目专员");
    const algos = memberNames(members, (r) => r === "算法工程师");
    const tpm = memberNames(members, (r) => r.toUpperCase() === "TPM" || r.includes("TPM"))[0]
        || memberNames(members, (r) => r.includes("开发人员")).join(" ");
    const dataNames = memberNames(members, (r) => r.includes("数据")).join(" ");
    const modelDeptNames = staffRows.map((r) => r[1]).join(" ");

    const fillReview = (tb: any[]): any[] => {
        if (!isReviewRecordGrid(tb)) return tb;
        return tb.map((row: any[]) => {
            if (!Array.isArray(row) || String(row[0] || "").trim() !== "参评人员") return row;
            const next = [...row];
            const put = (idx: number) => {
                const dept = String(next[idx] || "").trim();
                let names = "";
                if (dept === "模型部") names = modelDeptNames;
                else if (dept === "产品部") names = pm;
                else if (dept.includes("产品开发")) names = tpm;
                else if (dept === "数据部") names = dataNames;
                if (names && idx + 1 < next.length) next[idx + 1] = names;
            };
            put(1);
            put(3);
            return next;
        });
    };

    const fix = (n: any): any => {
        const title = stripNum(n.title);
        let body = n.body;
        let tables = Array.isArray(n.tables) ? n.tables.map((tb: any[]) => (Array.isArray(tb) ? tb.map((r: any[]) => (Array.isArray(r) ? [...r] : r)) : tb)) : n.tables;
        if (title === "项目简介" && pm) {
            if (/产品经理[：:]/.test(String(body || ""))) body = String(body).replace(/产品经理[：:][^\n]*/, `产品经理： ${pm}`);
            else body = `${String(body || "").replace(/\s*$/, "")}${body ? "\n" : ""}产品经理： ${pm}`;
        }
        if (title === "人员资源" && Array.isArray(tables) && Array.isArray(tables[0]) && tables[0][0]) {
            const hdr = tables[0][0];
            if (String(hdr[0] || "").includes("编号")) {
                tables = [[hdr, ...staffRows], ...tables.slice(1)];
            }
        }
        if (title.includes("里程碑") && Array.isArray(tables) && Array.isArray(tables[0]) && tables[0][0]) {
            const t = tables[0];
            const hi = t[0].findIndex((h: any) => String(h || "").includes("负责人"));
            const si = t[0].findIndex((h: any) => String(h || "").includes("阶段"));
            if (hi >= 0) {
                t.slice(1).forEach((row: any[]) => {
                    if (!Array.isArray(row)) return;
                    const stage = si >= 0 ? String(row[si] || "") : row.join(" ");
                    const names = /测试/.test(stage) ? testers : algos;
                    if (names.length) row[hi] = names.join("\n");
                });
            }
        }
        if (Array.isArray(tables)) tables = tables.map((tb: any[]) => fillReview(tb));
        return { ...n, body, tables, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
};

const fillMd017People = (nodes: any[], members: any[]): any[] => {
    const fillTb = (tb: any[]): any[] => {
        if (!Array.isArray(tb) || !Array.isArray(tb[0])) return tb;
        const hdr = tb[0].map((h: any) => String(h || ""));
        const pi = hdr.findIndex((h) => h.includes("资源数量") || h.includes("具体人员"));
        const ri = hdr.findIndex((h) => h.includes("角色"));
        if (pi < 0) return tb;
        const roleIdx = ri >= 0 ? ri : 0;
        return tb.map((row: any[], i: number) => {
            if (i === 0 || !Array.isArray(row)) return row;
            const next = [...row];
            const role = String(next[roleIdx] || "").trim();
            const names = role ? memberNames(members, (r) => r === role) : [];
            while (next.length <= pi) next.push("");
            next[pi] = names.length ? `${names.length}人/${names.join(" ")}` : "";
            return next;
        });
    };
    const fix = (n: any): any => {
        let tables = n.tables;
        if (stripNum(n.title) === "测试人员" && Array.isArray(tables)) {
            tables = tables.map((tb: any[]) => (Array.isArray(tb) ? fillTb(tb) : tb));
        }
        return { ...n, tables, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
};

const fillMd008Meta = (nodes: any[], members: any[], fileDate: string, signMap: Record<string, string>): any[] => {
    const auditee = memberNames(members, (r) => r === "算法工程师").join(" ");
    const auditorNames = memberNames(members, (r) => r === "高级算法工程师");
    const auditor = auditorNames.join(" ");
    const date = toDottedDate(fileDate);
    const sign = (auditorNames[0] && signMap[auditorNames[0]]) || auditor || "";
    const fillTb = (tb: any[]): any[] => {
        if (!isCodeReviewChecklistGrid(tb)) return tb;
        return tb.map((row: any[]) => {
            if (!Array.isArray(row)) return row;
            const next = [...row];
            while (next.length < 7) next.push("");
            const a = String(next[0] || "").trim();
            if (a === "代码地址") next[5] = date;
            if (a === "被审核人") {
                next[2] = auditee;
                next[5] = auditor;
            }
            if (a.includes("审核人") && a.includes("签字")) next[2] = sign;
            return next;
        });
    };
    const fix = (n: any): any => {
        let tables = n.tables;
        if (Array.isArray(tables)) tables = tables.map((tb: any[]) => (Array.isArray(tb) ? fillTb(tb) : tb));
        return { ...n, tables, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
};

const ensureEnvMaintChapter = (nodes: any[], docType: string): any[] => {
    if (docType !== "md_019" && docType !== "md_020") return nodes;
    const want = docType === "md_019" ? "开发环境维护记录" : "测试环境维护记录";
    const after = docType === "md_019" ? "开发环境定期检查" : "测试环境定期检查";
    let found: any = null;
    const hunt = (ns: any[]) => {
        (ns || []).forEach((n: any) => {
            if (stripNum(n.title) === want) found = n;
            hunt(n.children || []);
        });
    };
    hunt(nodes);
    if (found) return nodes;
    const node = { _key: genKey(), title: want, body: "", tables: [], children: [] };
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
    const wantTitle = opts.docType === "md_019" ? "开发环境维护记录" : "测试环境维护记录";
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
        const title = stripNum(n.title);
        const tables = title === wantTitle ? checks : n.tables;
        return { ...n, tables, children: (n.children || []).map(fix) };
    });
};

const MD022_ID_COLS = ["算法设计ID", "训练集构建", "调优集构建ID", "算法训练ID", "测试集构建ID", "算法测试ID"] as const;
const MD022_MODULES = ["肺栓塞分诊", "肺叶分割", "气管分割", "肺血管分割"];
const MD022_MODULE_DOC_TYPES: Record<string, Record<string, string>> = {
    "肺栓塞分诊": {
        "算法设计ID": "md_004",
        "训练集构建": "md_009_01",
        "调优集构建ID": "md_010_01",
        "算法训练ID": "md_012_01",
        "测试集构建ID": "md_011_01",
        "算法测试ID": "md_013_01",
    },
    "肺叶分割": {
        "算法设计ID": "md_004",
        "训练集构建": "md_009_02",
        "调优集构建ID": "md_010_02",
        "算法训练ID": "md_012_02",
        "测试集构建ID": "md_011_02",
        "算法测试ID": "md_013_02",
    },
};
const MD022_DHF_KEYWORDS: Record<string, string[]> = {
    md_004: ["算法方案概要设计"],
    md_009_01: ["训练集构建记录", "肺栓塞分割模型训练集"],
    md_009_02: ["训练集构建记录", "肺叶分割模型训练集"],
    md_010_01: ["调优集构建记录", "肺栓塞分割模型调优集"],
    md_010_02: ["调优集构建记录", "肺叶分割模型调优集"],
    md_011_01: ["测试集构建记录", "肺栓塞分诊模型测试集"],
    md_011_02: ["测试集构建记录", "肺叶分割模型测试集"],
    md_012_01: ["模型训练记录", "肺栓塞分割模型训练"],
    md_012_02: ["模型训练记录", "肺叶分割模型训练"],
    md_013_01: ["模型测试记录", "肺栓塞分诊模型测试记录"],
    md_013_02: ["模型测试记录", "肺叶分割模型测试记录"],
};

const normalizeDhfCode = (code: string): string => {
    let txt = String(code || "").trim();
    for (const sep of ["(", "（"]) {
        if (txt.includes(sep)) txt = txt.split(sep)[0].trim();
    }
    return txt;
};

const matchDhfCode = (rows: any[], keywords: string[]): string => {
    const kws = [...(keywords || [])].filter((k) => String(k || "").trim()).sort((a, b) => b.length - a.length);
    for (const kw of kws) {
        const exact = (rows || []).find((r: any) => String(r.name || "").trim() === kw && String(r.code || "").trim());
        if (exact) return normalizeDhfCode(exact.code);
        const fuzzy = (rows || []).find((r: any) => String(r.name || "").includes(kw) && String(r.code || "").trim());
        if (fuzzy) return normalizeDhfCode(fuzzy.code);
    }
    return "";
};

const collectMd022FileNos = (docs: any[], dhfRows: any[]): Record<string, string> => {
    const byType: Record<string, string> = {};
    (docs || []).forEach((d: any) => {
        const t = String(d.doc_type || "").trim();
        const no = String(d.file_no || "").trim();
        if (t && no && !byType[t]) byType[t] = no;
    });
    const out: Record<string, string> = {};
    Object.keys(MD022_DHF_KEYWORDS).forEach((t) => {
        out[t] = byType[t] || matchDhfCode(dhfRows, MD022_DHF_KEYWORDS[t]) || "";
    });
    return out;
};

const collectMd022Srs = (reqs: any[]): Record<string, string> => {
    const out: Record<string, string> = {};
    MD022_MODULES.forEach((m) => { out[m] = ""; });
    const blob = (r: any) => [r.module, r.function, r.sub_function].map((v) => String(v || "")).join(" ");
    let fallback = "";
    MD022_MODULES.forEach((module) => {
        const hits = (reqs || [])
            .filter((r: any) => String(r.type_code || "") !== "reqd" && blob(r).includes(module) && String(r.code || "").trim().toUpperCase().startsWith("SRS-"))
            .map((r: any) => String(r.code || "").trim())
            .sort();
        if (hits.length) {
            out[module] = hits[0];
            if (!fallback) fallback = hits[0];
        }
    });
    if (fallback) {
        MD022_MODULES.forEach((m) => { if (!out[m]) out[m] = fallback; });
    }
    return out;
};

const fillMd022Trace = (nodes: any[], fileNos: Record<string, string>, srsMap: Record<string, string>): any[] => {
    const fillTb = (tb: any[]): any[] => {
        if (!Array.isArray(tb) || !Array.isArray(tb[0])) return tb;
        const hdr = tb[0].map((h: any) => String(h || "").trim());
        const reqI = hdr.indexOf("算法需求");
        const modI = hdr.indexOf("模块");
        if (reqI < 0 || modI < 0) return tb;
        const colI: Record<string, number> = {};
        MD022_ID_COLS.forEach((name) => {
            const i = hdr.indexOf(name);
            if (i >= 0) colI[name] = i;
        });
        return tb.map((row: any[], i: number) => {
            if (i === 0 || !Array.isArray(row)) return row;
            const next = [...row];
            while (next.length < hdr.length) next.push("");
            const module = String(next[modI] || "").trim();
            const mapping = MD022_MODULE_DOC_TYPES[module] || {};
            next[reqI] = srsMap[module] || "";
            Object.keys(colI).forEach((name) => {
                const dt = mapping[name];
                next[colI[name]] = dt ? (fileNos[dt] || "") : "";
            });
            return next;
        });
    };
    const fix = (n: any): any => {
        let tables = n.tables;
        if (stripNum(n.title) === "模型可追溯性分析表" && Array.isArray(tables)) {
            tables = tables.map((tb: any[]) => (Array.isArray(tb) ? fillTb(tb) : tb));
        }
        return { ...n, tables, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
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

const dropMd001ProductInfo = (nodes: any[]): any[] =>
    (nodes || []).filter((n: any) => n.ref_type !== "basic_info" && stripNum(n.title) !== "产品信息")
        .map((n: any) => ({ ...n, children: dropMd001ProductInfo(n.children || []) }));

const NO_BASIC_INFO = new Set(["md_001", "md_004"]);

const takeMd001ProdName = (nodes: any[]): string => {
    for (const n of nodes || []) {
        if (n.ref_type === "basic_info" || stripNum(n.title) === "产品信息") {
            for (const tb of n.tables || []) {
                for (const row of tb || []) {
                    if (Array.isArray(row) && String(row[0] || "").trim() === "产品名称") {
                        const v = String(row[1] || "").trim();
                        if (v) return v;
                    }
                }
            }
        }
        const hit = takeMd001ProdName(n.children || []);
        if (hit) return hit;
    }
    return "";
};

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

const fillScopeBody = (body: string, name: string, replace = false): string => {
    const n = String(name || "").trim();
    const s = String(body || "");
    if (/产品名称[：:]/.test(s)) {
        if (!replace && /产品名称[：:]\s*\S/.test(s)) return s;
        return s.replace(/产品名称[：:][^\n]*/, n ? `产品名称：${n}` : "产品名称：");
    }
    const line = n ? `产品名称：${n}` : "产品名称：";
    return s ? `${line}\n${s}` : line;
};

const isProdNameTable = (tb: any) =>
    Array.isArray(tb?.[0]) && String(tb[0][0] || "").trim() === "产品名称" && (tb[0].length || 0) <= 2;

const takeNameFromScopeTables = (n: any): string => {
    for (const tb of n.tables || []) {
        if (!isProdNameTable(tb)) continue;
        for (const row of tb) {
            if (Array.isArray(row) && String(row[0] || "").trim() === "产品名称") {
                const v = String(row[1] || "").trim();
                if (v) return v;
            }
        }
    }
    return "";
};

const ensureScopeProductName = (nodes: any[], fallback = "") => {
    const visit = (arr: any[]) => {
        (arr || []).forEach((n: any) => {
            if (stripNum(n.title) === "范围") {
                const fromTbl = takeNameFromScopeTables(n);
                n.tables = (n.tables || []).filter((tb: any) => !isProdNameTable(tb));
                n.body = fillScopeBody(n.body || "", fromTbl || fallback);
            }
            visit(n.children || []);
        });
    };
    visit(nodes);
};

const applyMd001Layout = (nodes: any[]): any[] => {
    const prodName = takeMd001ProdName(nodes);
    const next = dropMd001ProductInfo(nodes);
    relocateMd001Tables(next);
    ensureScopeProductName(next, prodName);
    return next;
};

const relocateMd001Tables = (nodes: any[]) => {
    const map: Record<string, any> = {};
    const visit = (arr: any[]) => {
        (arr || []).forEach((n: any) => {
            map[stripNum(n.title)] = n;
            visit(n.children || []);
        });
    };
    visit(nodes);
    const hdr = (tb: any) => {
        if (!Array.isArray(tb?.[0]) || !tb[0].length) return { h: "", n: 0 };
        return { h: String(tb[0][0] || "").trim(), n: tb[0].length };
    };
    const pull = (title: string, pred: (tb: any) => boolean) => {
        const node = map[title];
        if (!node) return [] as any[];
        const tbs = node.tables || [];
        const moved = tbs.filter(pred);
        if (moved.length) node.tables = tbs.filter((tb: any) => !pred(tb));
        return moved;
    };

    const annex = map["附件 1 评审记录"];
    const movedReview = pull("配置管理工具", isReviewRecordGrid);
    if (annex && movedReview.length && !(annex.tables || []).some(isReviewRecordGrid)) {
        annex.tables = [...movedReview, ...(annex.tables || [])];
    }

    const ident = map["标识配置"];
    if (ident && !(ident.tables || []).length) {
        const isSci5 = (tb: any) => hdr(tb).h === "SCI名称" && hdr(tb).n >= 5;
        const isSci4 = (tb: any) => hdr(tb).h === "SCI名称" && hdr(tb).n === 4;
        const moved = [
            ...pull("目的", isSci5),
            ...pull("范围", isSci4),
            ...pull("目的", isSci4),
            ...pull("范围", isSci5),
        ];
        if (moved.length) ident.tables = moved;
    }

    const verp = map["版本更新原则"];
    if (verp && !(verp.tables || []).length) {
        const isTool = (tb: any) => hdr(tb).h === "工具类型";
        const moved = pull("缩写", isTool);
        if (moved.length) verp.tables = moved;
    }
};

const walkUnnumbered = (nodes: any[], map: Record<string, string>) => {
    (nodes || []).forEach((n: any) => {
        map[n._key] = "";
        walkUnnumbered(n.children || [], map);
    });
};

const computeNumbers = (nodes: any[], docType?: string): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    const skipAnnex = NO_BASIC_INFO.has(docType || "");
    (nodes || []).forEach((n: any) => {
        const t = stripNum(n.title);
        const skipNum = n.ref_type === "cover" || n.ref_type === "revision"
            || (skipAnnex && (n.ref_type === "basic_info" || t === "产品信息" || t.startsWith("附件")));
        if (skipNum) {
            map[n._key] = "";
            if (skipAnnex && (n.ref_type === "basic_info" || t === "产品信息" || t.startsWith("附件"))) {
                walkUnnumbered(n.children || [], map);
            } else {
                walkChildren(n.children || [], "", map);
            }
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
    const meta = getModelDocMeta(type);

    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        sections: [] as any[],
        activeKey: "",
        products: [] as any[],
    });

    const fillBasicInfo = (nodes: any[], info: Record<string, string>, replaceScopeName = false): any[] => {
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
            const isScope = stripNum(n.title) === "范围";
            let tables = n.tables;
            let body = n.body;
            if (isScope) body = fillScopeBody(n.body || "", info.name || "", replaceScopeName);
            if (isInfo && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) =>
                    Array.isArray(tb)
                        ? tb.map((row: any[]) => {
                              if (!Array.isArray(row) || row.length < 2) return row;
                              const k = String(row[0]).trim();
                              if (!(k in labelMap)) return row;
                              if (!replaceScopeName && String(row[1] || "").trim()) return row;
                              const next = [...row];
                              next[1] = labelMap[k];
                              return next;
                          })
                        : tb
                );
            }
            return { ...n, tables, body, children: (n.children || []).map(fix) };
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
            const isCover = n.ref_type === "cover";
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
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const autofill = (productId: number, secs: any[], version: string, replaceProduct = false, oldProductId = 0, _fileNo = ""): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            const oldId = replaceProduct && oldProductId && oldProductId !== productId ? oldProductId : 0;
            const md022Extra = type === "md_022";
            const envExtra = type === "md_019" || type === "md_020";
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                oldId ? ApiProduct.get_product({ id: oldId }).catch(() => null) : Promise.resolve(null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiPersonSign.list_person_sign({ page_index: 0, page_size: 1000 }).catch(() => null),
                md022Extra ? Api.list_model_doc({ product_id: productId, page_index: 0, page_size: 10000 }).catch(() => null) : Promise.resolve(null),
                md022Extra ? ApiProdDhf.list_prod_dhf({ prod_id: productId, page_index: 0, page_size: 10000 }).catch(() => null) : Promise.resolve(null),
                md022Extra ? ApiSrsDoc.list_srs_doc({ product_id: productId, page_index: 0, page_size: 5 }).catch(() => null) : Promise.resolve(null),
                envExtra ? Api.list_model_doc({ product_id: productId, doc_type: type === "md_019" ? "md_deq" : "md_teq", page_index: 0, page_size: 1 }).catch(() => null) : Promise.resolve(null),
            ]).then(async ([pr, oldPr, tl, mb, ps, mdList, dhfList, srsList, eqList]: any[]) => {
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
                const writer = findRole("模型部负责人", "模型负责人", "模型");
                const reviewer = findRole("算法", "研发负责人");
                const approver = findRole("研发负责人");
                const fileDate = computeFileDate(tlRows, meta.keywords.concat(meta.title));
                let out = fillBasicInfo(secs, {
                    name: prod.name,
                    version: prod.full_version,
                    code: prod.product_code,
                    scope: prod.scope,
                }, replaceProduct);
                out = fillCover(out, {
                    date: fileDate,
                    编制人: signOr(writer),
                    审核人: signOr(reviewer),
                    批准人: signOr(approver),
                }, replaceProduct);
                out = fillRevision(out, {
                    fileDate,
                    version,
                    reviser: writer || findRole("算法"),
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
                if (type === "md_006") {
                    out = fillModelCycle(out, computeModelCycle(tlRows));
                    out = fillMd006People(out, members);
                }
                if (type === "md_017") {
                    out = fillMd017People(out, members);
                }
                if (type === "md_022") {
                    const docRows = mdList && mdList.code === Api.C_OK ? ((mdList.data && mdList.data.rows) || []) : [];
                    const dhfRows = dhfList && dhfList.code === Api.C_OK ? ((dhfList.data && dhfList.data.rows) || []) : [];
                    let srsReqs: any[] = [];
                    const srsDoc = srsList && srsList.code === Api.C_OK ? (((srsList.data && srsList.data.rows) || [])[0] || null) : null;
                    if (srsDoc && srsDoc.id) {
                        const reqRes: any = await ApiSrsReq.list_srs_req({ doc_id: srsDoc.id, page_index: 0, page_size: 10000 }).catch(() => null);
                        srsReqs = reqRes && reqRes.code === Api.C_OK ? ((reqRes.data && reqRes.data.rows) || []) : [];
                    }
                    out = fillMd022Trace(out, collectMd022FileNos(docRows, dhfRows), collectMd022Srs(srsReqs));
                }
                if (type === "md_008_01" || type === "md_008_02") {
                    out = fillMd008Meta(out, members, fileDate, signMap);
                }
                if (type === "md_019" || type === "md_020") {
                    out = ensureEnvMaintChapter(out, type);
                    const checkerName = memberNames(members, (r) => r === "模型部负责人")[0]
                        || memberNames(members, (r) => r === "模型负责人")[0]
                        || "";
                    const eqDoc = eqList && eqList.code === Api.C_OK ? (((eqList.data && eqList.data.rows) || [])[0] || null) : null;
                    out = fillEnvMaint(out, {
                        prodName: newName,
                        fullVersion: String(prod.full_version || "").trim(),
                        weeks: computeDevTestWeeks(tlRows),
                        checker: (checkerName && signMap[checkerName]) || checkerName || "",
                        eqAssets: eqDoc ? parseEqAssets(eqDoc.content) : null,
                        docType: type,
                    });
                }
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
            let sections = ensureKeys((doc.content && doc.content.sections) || []);
            if (type === "md_001") sections = applyMd001Layout(sections);
            else sections = dropMd001ProductInfo(sections);
            autofill(doc.product_id, sections, doc.version, false, 0, doc.file_no || "").then((secs) => {
                dispatch({ loading: false, doc, sections: secs, activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        const prevId = data.doc.product_id;
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, data.doc.version, true, prevId, data.doc.file_no || "").then((secs) => dispatch({ loading: false, sections: secs }));
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
            const crr = isCodeReviewChecklistGrid(tb);
            return tb.map((row: any[], ri: number) => {
                if (ri < r || ri >= r + rs) return row;
                const next = [...row];
                while (next.length < ci + cs) next.push("");
                return next.map((cell: any, cc: number) => {
                    if (cc < ci || cc >= ci + cs) return cell;
                    if (crr) return (ri === r && cc === ci) ? val : "";
                    return val;
                });
            });
        });
        updateTables(tables);
    };
    const setEnvRowCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti || !Array.isArray(tb[r])) return tb;
            return tb.map((row: any[], ri: number) => {
                if (ri !== r) return row;
                const next = [...row];
                while (next.length <= ci) next.push("");
                next[ci] = val;
                return next;
            });
        });
        updateTables(tables);
    };
    const replaceCellImage = (ti: number, r: number, ci: number, file: File, colSpan = 1, rowSpan = 1) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCell(ti, r, ci, String(reader.result || ""), colSpan, rowSpan);
            message.success("图片已更换，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
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
        Api.update_model_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
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

    const numbers = computeNumbers(data.sections, type);
    const backPath = `/model_docs/${type || data.doc.doc_type || "md_001"}`;

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
                                    isEnvCheckGrid(tb) ? (() => {
                                        const kind = (String(tb[0][1] || "dev") === "server" ? "server" : "dev") as "server" | "dev";
                                        const groups = envCheckGroups(type || "md_019", kind);
                                        const cols = envCheckLeafCols(type || "md_019", kind);
                                        const title = envCheckTitle(type || "md_019", kind, String(tb[0][2] || ""));
                                        const dataRows = tb.slice(1);
                                        const tdBase: CSSProperties = { border: "1px solid #d9d9d9", padding: "4px 6px", fontSize: 12, verticalAlign: "middle" };
                                        const thCell: CSSProperties = { ...tdBase, background: "#fafafa", color: "#555", fontWeight: 600, textAlign: "center", whiteSpace: "pre-line" };
                                        const barCell: CSSProperties = { ...tdBase, background: "#f0f5ff", fontWeight: 600, color: "#1d39c4", textAlign: "center" };
                                        return (
                                    <div className="pdp-table-block" key={ti} style={{ overflowX: "auto" }}>
                                        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100, marginBottom: 8 }}>
                                            <tbody>
                                                <tr><td colSpan={cols.length} style={barCell}>{title}</td></tr>
                                                <tr>
                                                    {groups.map((g, gi) => (
                                                        g.leaves.length
                                                            ? <td key={gi} colSpan={g.leaves.length} style={thCell}>{g.label}</td>
                                                            : <td key={gi} rowSpan={2} style={thCell}>{g.label}</td>
                                                    ))}
                                                </tr>
                                                <tr>
                                                    {groups.flatMap((g, gi) => g.leaves.map((lf, li) => <td key={`${gi}-${li}`} style={thCell}>{lf}</td>))}
                                                </tr>
                                                {dataRows.length === 0 ? (
                                                    <tr><td colSpan={cols.length} style={{ ...tdBase, textAlign: "center", color: "#bbb" }}>该产品未查询到「开发~测试」时间线，暂无周记录</td></tr>
                                                ) : dataRows.map((row: any[], ri: number) => {
                                                    let checkIdx = -1;
                                                    return (
                                                        <tr key={ri}>
                                                            {cols.map((col, idx) => {
                                                                if (col.type === "date") {
                                                                    return <td key={idx} style={{ ...tdBase, textAlign: "center", whiteSpace: "pre-line", minWidth: 92 }}>{String(row[0] || "").replace("- ", "-\n")}</td>;
                                                                }
                                                                if (col.type === "problem") {
                                                                    const ci = checkIdx + 2;
                                                                    return (
                                                                        <td key={idx} style={{ ...tdBase, minWidth: 100, textAlign: "center" }}>
                                                                            <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 4 }} value={row[ci] ?? ""} disabled={readonly} onChange={(e) => setEnvRowCell(ti, ri + 1, ci, e.target.value)} />
                                                                        </td>
                                                                    );
                                                                }
                                                                if (col.type === "checker") {
                                                                    const ci = checkIdx + 3;
                                                                    const ck = String(row[ci] ?? "");
                                                                    return (
                                                                        <td key={idx} style={{ ...tdBase, textAlign: "center", minWidth: 120 }}>
                                                                            {ck.startsWith("data:image")
                                                                                ? <img src={ck} alt="检查人" style={{ height: 42, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
                                                                                : <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 3 }} value={ck} disabled={readonly} onChange={(e) => setEnvRowCell(ti, ri + 1, ci, e.target.value)} />}
                                                                        </td>
                                                                    );
                                                                }
                                                                checkIdx += 1;
                                                                const cj = checkIdx + 1;
                                                                const mk = String(row[cj] ?? "");
                                                                return (
                                                                    <td key={idx} style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap" }}>
                                                                        <div style={{ lineHeight: "22px" }}>
                                                                            <Checkbox checked={mk === "是"} disabled={readonly} onChange={() => setEnvRowCell(ti, ri + 1, cj, mk === "是" ? "" : "是")} style={{ transform: "scale(0.8)" }} />
                                                                            <span style={{ marginLeft: "2em", fontSize: 13 }}>是</span>
                                                                        </div>
                                                                        <div style={{ lineHeight: "22px" }}>
                                                                            <Checkbox checked={mk === "否"} disabled={readonly} onChange={() => setEnvRowCell(ti, ri + 1, cj, mk === "否" ? "" : "否")} style={{ transform: "scale(0.8)" }} />
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
                                    })() : (
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
                                                    const crr = isCodeReviewChecklistGrid(tb);
                                                    const spans = review ? computeGridSpans(tb) : crr ? computeCodeReviewSpans(tb) : null;
                                                    const cols = Math.max(crr ? 7 : 0, tb.reduce((m: number, row: any[]) => Math.max(m, Array.isArray(row) ? row.length : 0), 0));
                                                    const merged = review || crr;
                                                    return tb.map((row: any[], r: number) => (
                                                    <tr key={r}>
                                                        {(merged ? Array.from({ length: cols }, (_, ci) => ci) : row.map((_: any, ci: number) => ci)).map((ci: number) => {
                                                            const sp = spans?.[r]?.[ci];
                                                            if (sp?.skip) return null;
                                                            const cell = row[ci] ?? "";
                                                            const cs = sp?.colSpan || 1;
                                                            const rs = sp?.rowSpan || 1;
                                                            const left = String(row[0] ?? "");
                                                            const hasImg = typeof cell === "string" && cell.startsWith("data:image");
                                                            const isFlowSlot = left.includes("算法流程图") && ci > 0;
                                                            const figureSlot = isFlowSlot || (cols === 1 && (hasImg || !String(cell ?? "").trim()));
                                                            const figureLike = hasImg && figureSlot;
                                                            return (
                                                            <td
                                                                key={ci}
                                                                className={r === 0 ? "head" : ""}
                                                                colSpan={cs > 1 ? cs : undefined}
                                                                rowSpan={rs > 1 ? rs : undefined}
                                                                style={cs > 1 || rs > 1 ? { verticalAlign: "middle" } : undefined}
                                                            >
                                                                {hasImg ? (
                                                                    <span style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
                                                                        <img
                                                                            src={cell}
                                                                            alt={figureLike ? "算法图" : "签名"}
                                                                            style={{
                                                                                height: figureLike ? "auto" : 44,
                                                                                maxHeight: figureLike ? 420 : 44,
                                                                                width: "auto",
                                                                                maxWidth: "100%",
                                                                                objectFit: "contain",
                                                                                display: "inline-block",
                                                                                verticalAlign: "middle",
                                                                            }}
                                                                        />
                                                                        {!readonly && figureLike && (
                                                                            <Upload
                                                                                accept="image/*"
                                                                                showUploadList={false}
                                                                                beforeUpload={(f) => replaceCellImage(ti, r, ci, f as File, cs, rs)}
                                                                            >
                                                                                <Button size="small" icon={<UploadOutlined />} style={{ marginLeft: 6 }}>更换</Button>
                                                                            </Upload>
                                                                        )}
                                                                        {!readonly && (
                                                                            <DeleteOutlined title={figureLike ? "清除图片" : "清除签名"} style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "", cs, rs)} />
                                                                        )}
                                                                    </span>
                                                                ) : !readonly && figureSlot ? (
                                                                    <Upload
                                                                        accept="image/*"
                                                                        showUploadList={false}
                                                                        beforeUpload={(f) => replaceCellImage(ti, r, ci, f as File, cs, rs)}
                                                                    >
                                                                        <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
                                                                    </Upload>
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
                                    )
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
