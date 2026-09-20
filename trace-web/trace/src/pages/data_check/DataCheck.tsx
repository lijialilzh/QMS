import "../data_stats/DataStats.less";
import { Alert, Button, InputNumber, Space, Spin, Table, message } from "antd";
import { useEffect } from "react";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiDataDoc";
import * as ApiProduct from "@/api/ApiProduct";
import {
    CaseRow,
    StatsKind,
    buildTriageAoa,
    caseRowsFromContent,
    readStatsCache,
} from "../data_stats/dataStatsLocal";

type CheckItem = { ok: boolean; title: string; detail: string };
type FailRow = { key: number; item: string; group: string; metric: string; value: string };

const KINDS: StatsKind[] = ["ann", "base", "raw"];
const DD015: Record<StatsKind, string> = { raw: "dd_015_01", base: "dd_015_02", ann: "dd_015_03" };

const txt = (v: any) => String(v ?? "").trim();

const metricNum = (v: any): number | null => {
    const s = txt(v);
    if (!s || s === "/") return null;
    const n = parseFloat(s.replace(/%/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.abs(n) > 1.0001 ? n / 100 : n;
};

const parseQty = (v: any) => {
    const s = txt(v).replace(/,/g, "");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
};

const walkTables = (content: any): any[][][] => {
    const out: any[][][] = [];
    const walk = (ns: any[]) => {
        (ns || []).forEach((n) => {
            (n?.tables || []).forEach((tb: any) => { if (Array.isArray(tb)) out.push(tb); });
            walk(n?.children || []);
        });
    };
    walk((content && content.sections) || []);
    return out;
};

const latestDoc = async (productId: number, docType: string) => {
    const list: any = await Api.list_data_doc({ product_id: productId, doc_type: docType, page_index: 0, page_size: 1 });
    if (list.code !== Api.C_OK) throw new Error(list.msg || "查询数据文件失败");
    const hit = ((list.data && list.data.rows) || [])[0];
    if (!hit) return null;
    const got: any = await Api.get_data_doc({ id: hit.id });
    if (got.code !== Api.C_OK) throw new Error(got.msg || "打开数据文件失败");
    return got.data || null;
};

const countFromStatsDoc = (doc: any) => {
    const fromRows = caseRowsFromContent(doc?.content);
    if (fromRows && fromRows.rows.length) return fromRows.rows.length;
    let total = 0;
    walkTables(doc?.content).forEach((tb) => {
        tb.forEach((row) => {
            if (!Array.isArray(row)) return;
            const a = txt(row[0]);
            if (a.includes("数据总量") && total === 0) total = parseQty(row[1]);
        });
    });
    return total;
};

const sumReturnQty = (content: any) => {
    let sum = 0;
    let rows = 0;
    walkTables(content).forEach((tb) => {
        let qtyI = -1;
        let recvI = -1;
        tb.forEach((row) => {
            if (!Array.isArray(row)) return;
            const cells = row.map((c) => txt(c));
            const qi = cells.findIndex((c) => c === "回传数据量");
            const ri = cells.findIndex((c) => c === "实际接收量");
            if (qi >= 0) { qtyI = qi; recvI = ri; return; }
            if (qtyI < 0) return;
            const blob = cells.join("");
            if (/记录人|复核人/.test(blob) && !cells[0]) return;
            const site = cells[1] || cells[0];
            if (!site || site === "数据来源" || site === "多中心数据回传记录") return;
            const n = parseQty(row[qtyI]) || (recvI >= 0 ? parseQty(row[recvI]) : 0);
            if (n > 0 || txt(row[qtyI]) || (recvI >= 0 && txt(row[recvI]))) {
                sum += n;
                rows += 1;
            }
        });
    });
    return { sum, rows };
};

const parseExclude = (content: any) => {
    let n = 0;
    walkTables(content).forEach((tb) => {
        let concI = -1;
        tb.forEach((row) => {
            if (!Array.isArray(row)) return;
            const cells = row.map((c) => txt(c));
            const i = cells.findIndex((c) => /评估结论/.test(c));
            if (i >= 0) { concI = i; return; }
            if (concI < 0) return;
            const m = txt(row[concI]).match(/(\d+)\s*例/);
            if (m) n += parseInt(m[1], 10);
        });
    });
    return n;
};

const walkNodes = (content: any, fn: (n: any) => void) => {
    const walk = (ns: any[]) => {
        (ns || []).forEach((n) => {
            fn(n);
            walk(n?.children || []);
        });
    };
    walk((content && content.sections) || []);
};

const listReturnHospitals = (content: any) => {
    const out: Array<{ name: string; no: string; ret: number; act: number }> = [];
    walkTables(content).forEach((tb) => {
        let nameI = -1;
        let noI = -1;
        let retI = -1;
        let actI = -1;
        tb.forEach((row) => {
            if (!Array.isArray(row)) return;
            const cells = row.map((c) => txt(c));
            if (cells.includes("数据来源") && cells.includes("医院编号")) {
                nameI = cells.indexOf("数据来源");
                noI = cells.indexOf("医院编号");
                retI = cells.indexOf("回传数据量");
                actI = cells.indexOf("实际接收量");
                return;
            }
            if (nameI < 0) return;
            const blob = cells.join("");
            if (/记录人|复核人/.test(blob) && !cells[0]) return;
            const name = txt(row[nameI]);
            const no = noI >= 0 ? txt(row[noI]) : "";
            if (!name || name === "数据来源" || name === "多中心数据回传记录") return;
            out.push({
                name,
                no,
                ret: retI >= 0 ? parseQty(row[retI]) : 0,
                act: actI >= 0 ? parseQty(row[actI]) : 0,
            });
        });
    });
    return out;
};

const listTidyHospitals = (content: any) => {
    const out: Array<{ name: string; qty: number }> = [];
    walkTables(content).forEach((tb) => {
        let headerIdx = -1;
        let unitI = -1;
        let qtyI = -1;
        let hasSub = false;
        tb.forEach((row, ri) => {
            if (!Array.isArray(row) || headerIdx >= 0) return;
            const cells = row.map((c) => txt(c));
            const i = cells.findIndex((c) => /采集单位/.test(c));
            if (i < 0) return;
            headerIdx = ri;
            unitI = i;
            const sub = tb[ri + 1] || [];
            hasSub = Array.isArray(sub) && sub.some((c) => /数据量|检查方式/.test(txt(c)));
            qtyI = hasSub
                ? sub.findIndex((c: any) => /^数据量$/.test(txt(c)))
                : cells.findIndex((c) => /^数据量$/.test(c));
        });
        if (headerIdx < 0 || unitI < 0) return;
        const start = headerIdx + (hasSub ? 2 : 1);
        tb.slice(start).forEach((row) => {
            if (!Array.isArray(row)) return;
            const blob = (row || []).map((c) => txt(c)).join("");
            if (/记录人|复核人|签字/.test(blob) && !txt(row[unitI])) return;
            const name = txt(row[unitI]);
            if (!name) return;
            out.push({ name, qty: qtyI >= 0 ? parseQty(row[qtyI]) : 0 });
        });
    });
    return out;
};

const listUploadParts = (content: any) => {
    const parts: Record<string, { hospSum: number; hospN: number; sets: Array<{ name: string; qty: number }> }> = {
        raw: { hospSum: 0, hospN: 0, sets: [] },
        base: { hospSum: 0, hospN: 0, sets: [] },
        ann: { hospSum: 0, hospN: 0, sets: [] },
    };
    const kindOf = (title: string) => {
        const t = txt(title);
        if (/标注/.test(t)) return "ann";
        if (/基础/.test(t)) return "base";
        if (/原始/.test(t)) return "raw";
        return "";
    };
    walkNodes(content, (n) => {
        let kind = kindOf(n?.title);
        (n?.tables || []).forEach((tb: any) => {
            if (!Array.isArray(tb)) return;
            if (!kind && tb[0]) kind = kindOf((tb[0] || []).join(""));
            if (!kind) return;
            let headerIdx = -1;
            let iHosp = -1;
            let iSet = -1;
            let iQty = -1;
            tb.forEach((row: any, ri: number) => {
                if (!Array.isArray(row) || headerIdx >= 0) return;
                const cells = row.map((c: any) => txt(c));
                if (cells.includes("数据所属医院") && cells.includes("医院编号")) {
                    headerIdx = ri;
                    iHosp = cells.indexOf("数据所属医院");
                    iQty = cells.findIndex((c) => /上传数据量/.test(c));
                } else if (cells.includes("数据集") && cells.some((c) => /上传数据量/.test(c))) {
                    headerIdx = ri;
                    iSet = cells.indexOf("数据集");
                    iQty = cells.findIndex((c) => /上传数据量/.test(c));
                }
            });
            if (headerIdx < 0) return;
            tb.slice(headerIdx + 1).forEach((row: any) => {
                if (!Array.isArray(row)) return;
                const blob = row.map((c: any) => txt(c)).join("");
                if (/签字|记录人|复核人/.test(blob)) return;
                if (iSet >= 0) {
                    const name = txt(row[iSet]);
                    if (!name) return;
                    parts[kind].sets.push({ name, qty: iQty >= 0 ? parseQty(row[iQty]) : 0 });
                    return;
                }
                const hosp = iHosp >= 0 ? txt(row[iHosp]) : "";
                if (!hosp) return;
                parts[kind].hospN += 1;
                parts[kind].hospSum += iQty >= 0 ? parseQty(row[iQty]) : 0;
            });
        });
    });
    return parts;
};

const listDupBatches = (content: any) => {
    const out: Array<{ name: string; qty: number }> = [];
    walkTables(content).forEach((tb) => {
        let nameI = -1;
        let qtyI = -1;
        tb.forEach((row) => {
            if (!Array.isArray(row)) return;
            const cells = row.map((c) => txt(c));
            if (cells.includes("批次") && cells.includes("数据量")) {
                nameI = cells.indexOf("批次");
                qtyI = cells.indexOf("数据量");
                return;
            }
            if (nameI < 0) return;
            const name = txt(row[nameI]);
            if (!name || name === "批次") return;
            out.push({ name, qty: parseQty(row[qtyI]) });
        });
    });
    return out;
};

const txidHead = (row: CaseRow) => {
    const raw = txt((row as any).TXID || (row as any).txid);
    return raw.split("-")[0] || raw;
};

const loadRows = async (productId: number): Promise<CaseRow[]> => {
    for (let i = 0; i < KINDS.length; i++) {
        const hit = readStatsCache(productId, KINDS[i]);
        if (hit && hit.rows && hit.rows.length) return hit.rows;
    }
    for (let i = 0; i < KINDS.length; i++) {
        const doc = await latestDoc(productId, DD015[KINDS[i]]);
        const hit = caseRowsFromContent(doc?.content);
        if (hit && hit.rows.length) return hit.rows;
    }
    return [];
};

export default () => {
    const [data, dispatch] = useData({
        productId: 0,
        products: [] as any[],
        target: 0.8,
        exclude: null as number | null,
        loading: false,
        items: [] as CheckItem[],
        fails: [] as FailRow[],
    });

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const run = async () => {
        const productId = data.productId;
        if (!productId) {
            message.warning("请先选择产品");
            return;
        }
        const target = Number(data.target);
        if (!Number.isFinite(target)) {
            message.warning("请填写目标值");
            return;
        }
        dispatch({ loading: true, items: [], fails: [] });
        try {
            const items: CheckItem[] = [];
            const fails: FailRow[] = [];
            const rows = await loadRows(productId);
            if (!rows.length) {
                items.push({ ok: false, title: "亚组", detail: "请先在数据统计生成或写入病例明细" });
            } else {
                const aoa = buildTriageAoa(rows);
                aoa.slice(1).forEach((r) => {
                    const item = txt(r[0]);
                    const group = txt(r[1]);
                    ([["灵敏度", r[4]], ["特异度", r[5]]] as Array<[string, any]>).forEach(([metric, v]) => {
                        const n = metricNum(v);
                        if (n == null) return;
                        if (n + 1e-9 < target) {
                            fails.push({
                                key: fails.length + 1,
                                item, group, metric,
                                value: String(v),
                            });
                        }
                    });
                });
                items.push(fails.length
                    ? { ok: false, title: "亚组", detail: `${fails.length} 条低于目标值 ${target}` }
                    : { ok: true, title: "亚组", detail: `均满足目标值 ${target}` });
            }

            const rawDoc = await latestDoc(productId, "dd_015_01");
            const rawTotal = rawDoc ? countFromStatsDoc(rawDoc) : 0;
            const retDoc = await latestDoc(productId, "dd_002");
            if (!retDoc) {
                items.push({ ok: false, title: "多中心回传总数", detail: "没有多中心数据回传记录" });
            } else if (!rawTotal) {
                items.push({ ok: false, title: "多中心回传总数", detail: "没有原始数据库统计表或其中没有例数" });
            } else {
                const ret = sumReturnQty(retDoc.content);
                const ok = ret.sum === rawTotal;
                items.push({
                    ok,
                    title: "多中心回传总数",
                    detail: ok
                        ? `回传合计 ${ret.sum} = 原始库 ${rawTotal}（${ret.rows} 家医院）`
                        : `回传合计 ${ret.sum} ≠ 原始库 ${rawTotal}（${ret.rows} 家医院）`,
                });
            }

            const tidyDoc = await latestDoc(productId, "dd_003");
            const parsed = tidyDoc ? parseExclude(tidyDoc.content) : 0;
            const exclude = data.exclude == null ? parsed : Number(data.exclude) || 0;
            const baseDoc = await latestDoc(productId, "dd_015_02");
            const baseTotal = baseDoc ? countFromStatsDoc(baseDoc) : 0;
            const annDoc = await latestDoc(productId, "dd_015_03");
            const annTotal = annDoc ? countFromStatsDoc(annDoc) : 0;
            if (!rawTotal) {
                items.push({ ok: false, title: "基础库总量", detail: "没有原始数据库总数，无法用「数据量−剔除」核对基础库" });
            } else if (!baseDoc) {
                items.push({ ok: false, title: "基础库总量", detail: "没有基础数据库统计表" });
            } else {
                const expect = rawTotal - exclude;
                const ok = expect === baseTotal;
                items.push({
                    ok,
                    title: "基础库总量",
                    detail: ok
                        ? `原始库 ${rawTotal} − 剔除 ${exclude} = 基础库 ${baseTotal}`
                        : `原始库 ${rawTotal} − 剔除 ${exclude} = ${expect}，与基础库 ${baseTotal} 不一致`,
                });
            }

            try {
            if (!rawDoc && !baseDoc && !annDoc) {
                items.push({ ok: false, title: "三库例数", detail: "没有原始/基础/标注统计表，无法核对三库例数" });
            } else if (rawTotal && baseTotal && annTotal && rawTotal === baseTotal && baseTotal === annTotal) {
                items.push({ ok: true, title: "三库例数", detail: `原始/基础/标注均为 ${rawTotal}` });
            } else if (rawTotal && baseTotal && annTotal && rawTotal >= baseTotal && baseTotal >= annTotal) {
                items.push({ ok: true, title: "三库例数", detail: `原始 ${rawTotal} ≥ 基础 ${baseTotal} ≥ 标注 ${annTotal}` });
            } else {
                const miss = [
                    rawDoc ? "" : "原始",
                    baseDoc ? "" : "基础",
                    annDoc ? "" : "标注",
                ].filter(Boolean);
                const invert = rawTotal && baseTotal && annTotal && (baseTotal > rawTotal || annTotal > baseTotal);
                items.push({
                    ok: false,
                    title: "三库例数",
                    detail: invert
                        ? `原始 ${rawTotal} / 基础 ${baseTotal} / 标注 ${annTotal}，不满足「原始≥基础≥标注」`
                        : `原始 ${rawTotal || 0} / 基础 ${baseTotal || 0} / 标注 ${annTotal || 0}${miss.length ? `，缺${miss.join("、")}统计表` : ""}`,
                });
            }

            const retHosp = retDoc ? listReturnHospitals(retDoc.content) : [];
            if (!retDoc) {
                items.push({ ok: false, title: "回传与实际接收", detail: "没有多中心数据回传记录" });
            } else if (!retHosp.length) {
                items.push({ ok: false, title: "回传与实际接收", detail: "回传表没有医院行" });
            } else {
                const diff = retHosp.filter((h) => h.ret !== h.act);
                items.push({
                    ok: !diff.length,
                    title: "回传与实际接收",
                    detail: diff.length
                        ? `${diff.length} 家医院回传数据量≠实际接收量，如 ${diff[0].name} ${diff[0].ret}/${diff[0].act}`
                        : `${retHosp.length} 家医院回传数据量=实际接收量`,
                });
            }

            const tidyHosp = tidyDoc ? listTidyHospitals(tidyDoc.content) : [];
            if (!retDoc || !tidyDoc) {
                items.push({
                    ok: false,
                    title: "回传医院与整理医院",
                    detail: !retDoc ? "没有多中心数据回传记录" : "没有数据整理记录",
                });
            } else {
                const retNames = new Set(retHosp.map((h) => h.name));
                const tidyNames = new Set(tidyHosp.map((h) => h.name));
                const onlyRet = [...retNames].filter((n) => !tidyNames.has(n));
                const onlyTidy = [...tidyNames].filter((n) => !retNames.has(n));
                const ok = !onlyRet.length && !onlyTidy.length && retNames.size > 0;
                items.push({
                    ok,
                    title: "回传医院与整理医院",
                    detail: ok
                        ? `${retNames.size} 家医院两边一致`
                        : `回传有整理无 ${onlyRet.length} 家，整理有回传无 ${onlyTidy.length} 家`,
                });
            }

            if (!retDoc || !tidyDoc) {
                items.push({
                    ok: false,
                    title: "整理数据量与回传",
                    detail: !retDoc ? "没有多中心数据回传记录" : "没有数据整理记录",
                });
            } else {
                const retSum = retHosp.reduce((s, h) => s + (h.ret || h.act), 0);
                const tidySum = tidyHosp.reduce((s, h) => s + h.qty, 0);
                const ok = retSum === tidySum && retSum > 0;
                items.push({
                    ok,
                    title: "整理数据量与回传",
                    detail: ok
                        ? `整理数据量合计 ${tidySum} = 回传合计 ${retSum}`
                        : `整理数据量合计 ${tidySum} ≠ 回传合计 ${retSum}`,
                });
            }

            const upDoc = await latestDoc(productId, "dd_010");
            if (!upDoc) {
                items.push({ ok: false, title: "上传记录与统计表", detail: "没有数据库上传记录" });
            } else {
                const parts = listUploadParts(upDoc.content);
                const lines: string[] = [];
                let ok = true;
                ([["raw", "原始", rawTotal, parts.raw.hospSum], ["base", "基础", baseTotal, parts.base.hospSum]] as const).forEach(([, label, stat, up]) => {
                    if (!stat && !up) {
                        lines.push(`${label}两边都没有例数`);
                        ok = false;
                        return;
                    }
                    if (stat !== up) {
                        lines.push(`${label}上传 ${up} ≠ 统计表 ${stat}`);
                        ok = false;
                    } else {
                        lines.push(`${label}上传 ${up} = 统计表 ${stat}`);
                    }
                });
                const annUp = parts.ann.sets.length
                    ? (parts.ann.sets.every((s) => s.qty === parts.ann.sets[0].qty) ? parts.ann.sets[0].qty : parts.ann.sets.reduce((s, x) => s + x.qty, 0))
                    : parts.ann.hospSum;
                if (annTotal || annUp) {
                    if (annTotal === annUp) lines.push(`标注上传 ${annUp} = 统计表 ${annTotal}`);
                    else {
                        lines.push(`标注上传 ${annUp} ≠ 统计表 ${annTotal}`);
                        ok = false;
                    }
                }
                items.push({ ok, title: "上传记录与统计表", detail: lines.join("；") || "上传记录没有可核对的医院/数据集行" });
            }

            const dupDoc = await latestDoc(productId, "dd_012");
            if (!dupDoc) {
                items.push({ ok: false, title: "查重与标注上传", detail: "没有训练集测试集查重记录" });
            } else if (!upDoc) {
                items.push({ ok: false, title: "查重与标注上传", detail: "没有数据库上传记录，无法按数据集核对查重数据量" });
            } else {
                const batches = listDupBatches(dupDoc.content);
                const annSets = listUploadParts(upDoc.content).ann.sets;
                if (!batches.length) {
                    items.push({ ok: false, title: "查重与标注上传", detail: "查重记录没有批次行" });
                } else if (!annSets.length) {
                    items.push({ ok: false, title: "查重与标注上传", detail: "上传记录标注库没有数据集行" });
                } else {
                    const byName: Record<string, number> = {};
                    annSets.forEach((s) => { byName[s.name] = s.qty; });
                    const miss = batches.filter((b) => byName[b.name] == null);
                    const diff = batches.filter((b) => byName[b.name] != null && byName[b.name] !== b.qty);
                    const ok = !miss.length && !diff.length;
                    items.push({
                        ok,
                        title: "查重与标注上传",
                        detail: ok
                            ? `${batches.length} 个批次数据量与标注上传一致`
                            : `${miss.length ? `查重有上传无 ${miss.length} 个` : ""}${miss.length && diff.length ? "；" : ""}${diff.length ? `数量不一致 ${diff.length} 个，如 ${diff[0].name} ${diff[0].qty}/${byName[diff[0].name]}` : ""}`,
                    });
                }
            }

            if (!rows.length) {
                items.push({ ok: false, title: "病例标识", detail: "没有病例明细，无法核对 TXID / PatientID" });
                items.push({ ok: false, title: "TXID 与回传医院", detail: "没有病例明细，无法按 TXID 对照回传医院编号" });
                items.push({ ok: false, title: "关键字段完整", detail: "没有病例明细，无法核对性别/年龄/设备" });
            } else {
                const txids = rows.map((r) => txt((r as any).TXID || (r as any).txid));
                const pids = rows.map((r) => txt((r as any).PatientID || (r as any).patientId));
                const emptyTx = txids.filter((s) => !s).length;
                const emptyPid = pids.filter((s) => !s).length;
                const dupTx = txids.filter((s, i) => s && txids.indexOf(s) !== i);
                const uniqDupTx = Array.from(new Set(dupTx));
                const okId = !emptyTx && !uniqDupTx.length;
                items.push({
                    ok: okId,
                    title: "病例标识",
                    detail: okId
                        ? `${rows.length} 例 TXID 均有且不重复${emptyPid ? `；PatientID 空 ${emptyPid} 例` : ""}`
                        : `TXID 空 ${emptyTx} 例，重复 ${uniqDupTx.length} 个${emptyPid ? `；PatientID 空 ${emptyPid} 例` : ""}`,
                });

                if (!retDoc || !retHosp.length) {
                    items.push({ ok: false, title: "TXID 与回传医院", detail: "没有回传医院编号，无法核对 TXID 第一段" });
                } else {
                    const nos = new Set(retHosp.map((h) => h.no.toUpperCase()).filter(Boolean));
                    const heads = rows.map((r) => txidHead(r));
                    const miss = heads.filter((h) => h && !nos.has(h.toUpperCase()));
                    const uniqMiss = Array.from(new Set(miss));
                    items.push({
                        ok: !uniqMiss.length,
                        title: "TXID 与回传医院",
                        detail: uniqMiss.length
                            ? `${uniqMiss.length} 个 TXID 前段未命中回传医院编号，如 ${uniqMiss[0]}`
                            : `${rows.length} 例 TXID 前段均能对应回传医院编号`,
                    });
                }

                const emptySex = rows.filter((r) => !txt((r as any).SEX || (r as any).sex)).length;
                const emptyAge = rows.filter((r) => !txt((r as any).AGE || (r as any).age)).length;
                const emptyDev = rows.filter((r) => !txt((r as any).DEVICE || (r as any).device)).length;
                const okField = !emptySex && !emptyAge && !emptyDev;
                items.push({
                    ok: okField,
                    title: "关键字段完整",
                    detail: okField
                        ? `${rows.length} 例均有性别、年龄、设备`
                        : `性别空 ${emptySex}、年龄空 ${emptyAge}、设备空 ${emptyDev}`,
                });
            }
            } catch (extraErr: any) {
                items.push({ ok: false, title: "其他核对", detail: extraErr?.message || "额外核对失败" });
            }

            dispatch({ loading: false, items, fails });
        } catch (e: any) {
            dispatch({ loading: false });
            message.error(e?.message || "自查失败");
        }
    };

    return (
        <div className="div-v page data-stats">
            <div className="data-stats-toolbar">
                <span className="data-stats-title">数据自查</span>
                <span className="data-stats-label">选择产品：</span>
                <span className="data-stats-product">
                    <ProductVersionSelect
                        products={data.products}
                        value={data.productId || undefined}
                        namePlaceholder="产品名称"
                        versionPlaceholder="完整版本"
                        onChange={(v) => dispatch({ productId: v || 0, items: [], fails: [] })}
                    />
                </span>
                <span className="data-stats-label">目标值</span>
                <InputNumber min={0} max={1} step={0.01} value={data.target} onChange={(v) => dispatch({ target: v ?? 0.8 })} />
                <span className="data-stats-label">剔除例数</span>
                <InputNumber min={0} step={1} placeholder="可空，从评估结论解析" value={data.exclude as any} onChange={(v) => dispatch({ exclude: v })} />
                <Space>
                    <Button type="primary" onClick={run} loading={data.loading}>自查</Button>
                </Space>
            </div>
            <div className="data-stats-hint">
                共 12 项：亚组、回传总数、基础库总量、三库例数、回传与实际接收、回传/整理医院、整理数据量、上传记录与统计表、查重与标注上传、病例标识、TXID 与回传医院、关键字段完整。不改任何数据文件。
            </div>
            <Spin spinning={data.loading}>
                <Space direction="vertical" style={{ width: "100%", marginTop: 12 }} size={8}>
                    {(data.items || []).map((it: CheckItem, idx: number) => (
                        <Alert key={`${idx}-${it.title}`} type={it.ok ? "success" : "error"} showIcon message={it.title} description={it.detail} />
                    ))}
                    {!!(data.fails || []).length && (
                        <Table
                            size="small"
                            pagination={false}
                            dataSource={data.fails}
                            columns={[
                                { title: "因素", dataIndex: "item", width: 120 },
                                { title: "亚组", dataIndex: "group" },
                                { title: "指标", dataIndex: "metric", width: 100 },
                                { title: "实际值", dataIndex: "value", width: 100 },
                            ]}
                        />
                    )}
                </Space>
            </Spin>
        </div>
    );
};
