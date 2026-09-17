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
                亚组即统计结果中的类别。灵敏度/特异度低于目标值会列出；「/」跳过。回传合计对照原始库；基础库对照「原始库−剔除」。
            </div>
            <Spin spinning={data.loading}>
                <Space direction="vertical" style={{ width: "100%", marginTop: 12 }} size={8}>
                    {(data.items || []).map((it: CheckItem) => (
                        <Alert key={it.title} type={it.ok ? "success" : "error"} showIcon message={it.title} description={it.detail} />
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
