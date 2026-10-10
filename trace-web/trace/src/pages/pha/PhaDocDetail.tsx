import { Button, Input, Popconfirm, Space, Spin, message } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiPhaDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiProdHaz from "@/api/ApiProdHaz";
import * as ApiMember from "@/api/ApiProjectMember";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewTable from "@/common/ReviewTable";
import EditableTableGenerator from "@/pages/srs_doc/components/EditableTableGenerator";
import "../pdp/PdpDocDetail.less";
import { syncDocVersionFields } from "@/pages/doc_fill/syncDocVersion";

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

const isReviewNode = (n: any) => !!n && (n.ref_type === "review" || stripNum(n.title).includes("评审记录"));

const isOtherLabel = (text: string) => text.startsWith("其他参会人员") || text.startsWith("其他参评人员");
const isBannerLabel = (text: string) => ["参评人员签字", "评审时间", "评审结论", "批准人员签字"].some((b) => text.startsWith(b));
const isFullRow = (row: any[]) => (row || []).length > 1
    && String(row?.[0] ?? "").trim() !== ""
    && (row || []).slice(1).every((c: any) => String(c ?? "").trim() === "");

const SIGN_MARK = "（签名图）";

// 展示时把连续相同的类别留空，交给只读表按需求规格说明的规则纵向合并。评审结论列不合并。
const reviewDisplayGrid = (tb: any[]) => {
    const rows = (tb || []).map((row: any[]) => [...(row || [])]);
    let prev = "";
    rows.forEach((row) => {
        const t = String(row[0] ?? "").trim();
        if (isBannerLabel(t) || isOtherLabel(t) || isFullRow(row)) {
            prev = "";
            return;
        }
        if (t && t === prev) row[0] = "";
        else if (t) prev = t;
    });
    return rows;
};

const isReviewHeaderRow = (tb: any[]) => {
    const first = (tb?.[0] || []).map((c: any) => String(c ?? "").trim());
    if (!first.length || isBannerLabel(first[0] || "")) return false;
    const filled = first.filter(Boolean);
    return filled.length === first.length && first.every((c: string) => c.length > 0 && c.length < 40);
};

// 模板内置的基准产品名称，按所选产品名称全文替换
const BASE_NAME = "肿瘤CT图像随访与评估软件";
// 封面/修订日期从时间逻辑线匹配的关键字。不用「风险管理」，避免命中风险管理报告/计划。
const DATE_KEYWORDS = ["初步危害分析", "危害分析"];
const FMEA_KEYS = ["CFMEA", "DFMEA", "PFMEA"];

const cellText = (r: any) => Object.values(r.cells || {}).map((v: any) => String(v || ""));
const hitWords = (r: any, words: string[]) => cellText(r).some((v) => words.some((k) => v.includes(k)));

// 时间线里找含关键字输出的日期。优先含「评审」的行，取最新一天，格式「YYYY年M月D日」
const computeDate = (rows: any[], keywords: string[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const dates = (rows || []).filter((r: any) => (r.row_type || "date") === "date" && hitWords(r, keywords));
    const reviewed = dates.filter((r: any) => hitWords(r, ["评审"]));
    const matches = reviewed.length ? reviewed : dates;
    if (!matches.length) return "";
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) > key(best)) best = r; });
    return `${num(best.year)}年${num(best.month)}月${num(best.day)}日`;
};

const isDateLabel = (value: any) => String(value ?? "").replace(/[\s\u3000]/g, "") === "日期";

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

// 全文替换产品名称
const replaceName = (nodes: any[], oldName: string, newName: string): any[] => {
    if (!oldName || !newName || oldName === newName) return nodes;
    const rep = (s: any) => String(s ?? "").split(oldName).join(newName);
    const fix = (n: any): any => ({
        ...n,
        title: rep(n.title),
        body: rep(n.body),
        tables: (n.tables || []).map((tb: any[]) =>
            Array.isArray(tb) ? tb.map((row: any[]) => (Array.isArray(row) ? row.map((c: any) => (typeof c === "string" ? rep(c) : c)) : row)) : tb
        ),
        children: (n.children || []).map(fix),
    });
    return (nodes || []).map(fix);
};

const isFmea = (n: any): boolean => n.ref_type === "pha_fmea" || FMEA_KEYS.some((k) => stripNum(n.title).includes(k));

const hazNo = (code: string) => parseInt(String(code || "").replace(/\D/g, ""), 10) || 0;

// 1.2/1.3/1.4：只保留该产品版本产品 HAZ 里、且模板把该编号分到本章的危害。不铺危害总表。
const fillFmea = (nodes: any[], hazMap: Record<string, any>): any[] => {
    const hasProductHaz = Object.keys(hazMap || {}).length > 0;
    const fillTb = (tb: any[]): any[] => {
        if (!Array.isArray(tb) || !tb.length || !hasProductHaz) return tb;
        let hidx = -1;
        for (let i = 0; i < tb.length; i++) {
            const r = tb[i];
            if (Array.isArray(r) && r.some((c: any) => String(c).includes("危害编号")) && r.some((c: any) => String(c).includes("潜在故障模式"))) {
                hidx = i;
                break;
            }
        }
        if (hidx < 0) return tb;
        const header = tb[hidx];
        const colOf = (kw: string) => header.findIndex((c: any) => String(c).includes(kw));
        const codeIdx = colOf("危害编号");
        const processIdx = colOf("过程");
        const modeIdx = colOf("潜在故障模式");
        const causeIdx = colOf("故障的潜在原因");
        const damageIdx = colOf("失效的潜在影响");
        const categoryIdx = colOf("分类");
        if (codeIdx < 0) return tb;
        const processByCode: Record<string, string> = {};
        tb.slice(hidx + 1).forEach((row: any[]) => {
            if (!Array.isArray(row) || codeIdx >= row.length) return;
            const m = String(row[codeIdx]).toUpperCase().match(/HAZ\d+/);
            if (!m || processByCode[m[0]]) return;
            processByCode[m[0]] = processIdx >= 0 ? String(row[processIdx] ?? "") : "";
        });
        const codes = Object.keys(processByCode).filter((code) => hazMap[code]).sort((a, b) => hazNo(a) - hazNo(b));
        const blank = header.map(() => "");
        const data = codes.map((code) => {
            const info = hazMap[code] || {};
            const row = [...blank];
            if (processIdx >= 0) row[processIdx] = processByCode[code] || "";
            if (modeIdx >= 0) row[modeIdx] = info.source || "";
            if (causeIdx >= 0) row[causeIdx] = info.situation || info.event || "";
            if (damageIdx >= 0) row[damageIdx] = info.damage || "";
            if (categoryIdx >= 0) row[categoryIdx] = info.category || "";
            row[codeIdx] = code;
            return row;
        });
        return [...tb.slice(0, hidx + 1), ...data];
    };
    const fix = (n: any): any => ({
        ...n,
        tables: isFmea(n) ? (n.tables || []).map(fillTb) : n.tables,
        children: (n.children || []).map(fix),
    });
    return (nodes || []).map(fix);
};

// 封面/修订记录日期
const memberName = (rows: any[], roleKey: string) => {
    const hit = (rows || []).find((m: any) => String(m.role || "").includes(roleKey) && String(m.name || "").trim());
    return hit ? String(hit.name).trim() : "";
};

const fillDates = (nodes: any[], date: string, version: string, reviser = "", approver = ""): any[] => {
    const isCover = (n: any) => n.ref_type === "cover" || stripNum(n.title) === "初步危害分析清单";
    const isRev = (n: any) => n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
    const coverTbl = (tb: any[]) =>
        tb.map((row: any[]) => {
            if (!Array.isArray(row)) return row;
            const next = [...row];
            if (String(row[0]).trim() === "生效日期") {
                // 生效日期与编制/审核/批准日期统一为时间线同一天，打开即覆盖
                if (next.length >= 2) next[1] = date;
                return next;
            }
            for (let ci = 0; ci < next.length; ci++) {
                if (isDateLabel(next[ci]) && ci + 1 < next.length) next[ci + 1] = date;
            }
            return next;
        });
    const revTbl = (tb: any[]) => {
        const t = tb.map((r: any[]) => (Array.isArray(r) ? [...r] : r));
        while (t.length < 2) t.push(["", "", "", "", ""]);
        const row = t[1];
        while (row.length < 5) row.push("");
        row[0] = date || "";
        if (version) row[1] = version;
        if (!String(row[2] || "").trim()) row[2] = "首次发布";
        // 修订人、批准人只写姓名，不放签名章
        row[3] = reviser || "";
        row[4] = approver || "";
        return t;
    };
    const fix = (n: any): any => {
        let tables = n.tables;
        if (isCover(n) && Array.isArray(n.tables)) tables = n.tables.map(coverTbl);
        else if (isRev(n) && Array.isArray(n.tables) && Array.isArray(n.tables[0])) tables = [revTbl(n.tables[0]), ...n.tables.slice(1)];
        return { ...n, tables, children: (n.children || []).map(fix) };
    };
    return (nodes || []).map(fix);
};

const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "revision" || n.ref_type === "review") {
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
        doc: {} as any,
        sections: [] as any[],
        activeKey: "",
        products: [] as any[],
    });

    const autofill = (productId: number, secs: any[], version: string, oldName: string): Promise<{ sections: any[]; date: string }> =>
        new Promise((resolve) => {
            if (!productId) { resolve({ sections: secs, date: "" }); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiProdHaz.list_prod_haz({ prod_id: productId, page_index: 0, page_size: 10000 }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
            ]).then(([pr, tl, ph, mb]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const hazRows = ph && ph.code === Api.C_OK ? ((ph.data && ph.data.rows) || []) : [];
                const hazMap: Record<string, any> = {};
                hazRows.forEach((h: any) => {
                    const code = String(h.code || "").trim().toUpperCase();
                    if (code) {
                        hazMap[code] = {
                            source: String(h.source || "").trim(),
                            event: String(h.event || "").trim(),
                            situation: String(h.situation || "").trim(),
                            damage: String(h.damage || "").trim(),
                            category: String(h.category || "").trim(),
                        };
                    }
                });
                const newName = String(prod.name || "").trim();
                let out = replaceName(secs, BASE_NAME, newName);
                if (oldName && oldName !== newName) out = replaceName(out, oldName, newName);
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const date = computeDate(tlRows, DATE_KEYWORDS);
                out = fillDates(out, date, version, memberName(members, "产品经理"), memberName(members, "产品负责人"));
                out = fillFmea(out, hazMap);
                resolve({ sections: out, date });
            }).catch(() => resolve({ sections: secs, date: "" }));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_pha_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = ensureKeys((doc.content && doc.content.sections) || []);
            autofill(doc.product_id, sections, doc.version, doc.product_name).then(({ sections: secs }) => {
                dispatch({ loading: false, doc, sections: syncDocVersionFields(secs, doc.version), activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        const oldName = data.doc.product_name;
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, data.doc.version, oldName).then(({ sections: secs, date }) => {
            dispatch({ loading: false, sections: secs });
            if (!date) {
                message.warning("该产品未查询到对应时间线，日期已清空");
            }
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
        const idx = sections.findIndex((n: any) => n.ref_type === "review" || stripNum(n.title).includes("评审记录"));
        if (idx >= 0) sections.splice(idx, 0, node);
        else sections.push(node);
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
    };

    const active = findNode(data.sections, data.activeKey);
    const updateTables = (tables: any[]) => patchNode(data.activeKey, { tables });
    const [reviewEdit, setReviewEdit] = useState<any>(null);
    const openReviewEdit = (ti: number, tb: any[]) => {
        const split = isReviewHeaderRow(tb);
        const body = split ? tb.slice(1) : tb;
        const cols = Math.max(1, ...(tb || []).map((row: any[]) => (row || []).length));
        const signs: Record<string, string> = {};
        const dataRows = body.map((row: any[], ri: number) => Array.from({ length: cols }, (_, ci) => {
            const raw = String(row?.[ci] ?? "");
            if (raw.startsWith("data:image")) {
                signs[`${ri},${ci}`] = raw;
                return SIGN_MARK;
            }
            return raw;
        }));
        const headers = split
            ? (tb[0] || []).map((c: any, i: number) => ({ code: `c${i}`, name: String(c ?? "") }))
            : Array.from({ length: cols }, (_, i) => ({ code: `c${i}`, name: `列${i + 1}` }));
        setReviewEdit({ ti, split, signs, initial: { headers, data: dataRows } });
    };
    const saveReviewEdit = (tableData: any) => {
        if (!reviewEdit) return;
        const { ti, split, signs } = reviewEdit;
        const body = (tableData.data || []).map((row: any[], ri: number) => (row || []).map((c: any, ci: number) => {
            const text = String(c ?? "");
            return text === SIGN_MARK && signs[`${ri},${ci}`] ? signs[`${ri},${ci}`] : text;
        }));
        const grid = split ? [(tableData.headers || []).map((h: any) => h.name || ""), ...body] : body;
        updateTables((active.tables || []).map((tb: any[], i: number) => (i === ti ? grid : tb)));
        setReviewEdit(null);
    };
    const setCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = (active.tables || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.map((row: any[], ri: number) =>
                ri !== r ? row : row.map((cell: any, cc: number) => (cc === ci ? val : cell))
            )
        );
        updateTables(tables);
    };
    const setRowText = (ti: number, r: number, val: string) => {
        const tables = (active.tables || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.map((row: any[], ri: number) => (ri !== r ? row : row.map(() => val)))
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
    const addTable = () => updateTables([...(active.tables || []), [["", ""], ["", ""]]]);
    const delTable = (ti: number) => updateTables((active.tables || []).filter((_: any, i: number) => i !== ti));

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        // 保存时把当前产品名归一化回基准名，保证库内模板始终以 BASE_NAME 存储
        const content = { sections: replaceName(stripKeys(data.sections), data.doc.product_name, BASE_NAME) };
        Api.update_pha_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_pha_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const numbers = computeNumbers(data.sections);

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
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/pha_docs")}>{ts("back")}</Button>
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
                                        placeholder="只填名称"
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

                                {(active.tables || []).map((tb: any[], ti: number) => {
                                    if (isReviewNode(active)) {
                                        return (
                                            <div className="pdp-table-block" key={ti}>
                                                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                                    <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
                                                        <ReviewTable grid={reviewDisplayGrid(tb)} headerRows={isReviewHeaderRow(tb) ? 1 : 0} />
                                                    </div>
                                                    {!readonly && (
                                                        <Space size={8} style={{ flexShrink: 0, marginTop: 8 }}>
                                                            <Button size="small" icon={<EditOutlined />} onClick={() => openReviewEdit(ti, tb)}>编辑</Button>
                                                            <Popconfirm title="确定删除此表？" okText="确定" cancelText="取消" onConfirm={() => delTable(ti)}>
                                                                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                                                            </Popconfirm>
                                                        </Space>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    }
                                    const review = false;
                                    const col0 = null as { rowspan: number[]; skip: boolean[] } | null;
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
                                        <table className={review ? "pdp-grid review-grid" : "pdp-grid"}>
                                            <tbody>
                                                {tb.map((row: any[], r: number) => {
                                                    const texts = (row || []).map((c: any) => String(c ?? "").trim());
                                                    const banner = texts.find((t) => t && !t.startsWith("data:image"));
                                                    const mergeAll = !review && !!banner && texts.length > 1 && texts.every((t) => t === banner);
                                                    const label = String(row?.[0] ?? "").trim();
                                                    const otherRow = review && row.length > 2 && isOtherLabel(label);
                                                    const mergeRow = review && isFullRow(row);
                                                    const centerRow = mergeRow && (label.startsWith("参评人员签字") || label.startsWith("评审时间"));
                                                    return (
                                                    <tr key={r}>
                                                        {otherRow ? (
                                                            <>
                                                                <td className={r === 0 ? "head" : ""} style={{ textAlign: "center", verticalAlign: "middle" }}>{row[0]}</td>
                                                                <td colSpan={row.length - 1} style={{ textAlign: "center", verticalAlign: "middle" }}>/</td>
                                                            </>
                                                        ) : mergeRow || mergeAll ? (
                                                            <td className={r === 0 ? "head" : ""} colSpan={row.length} style={{ textAlign: "center", verticalAlign: "middle" }}>
                                                                <Input.TextArea
                                                                    className="pdp-cell"
                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                    value={row[0] ?? ""}
                                                                    disabled={readonly}
                                                                    style={(centerRow || mergeAll) ? { textAlign: "center" } : undefined}
                                                                    onChange={(e) => (mergeAll ? setRowText(ti, r, e.target.value) : setCell(ti, r, 0, e.target.value))}
                                                                />
                                                            </td>
                                                        ) : row.map((cell: any, ci: number) => {
                                                            if (ci === 0 && col0?.skip[r]) return null;
                                                            const rs = ci === 0 && col0 && col0.rowspan[r] > 1 ? col0.rowspan[r] : undefined;
                                                            const center = r === 0 || ci === 0;
                                                            return (
                                                            <td key={ci} className={r === 0 ? "head" : ""} rowSpan={rs} style={{ verticalAlign: "middle", textAlign: center ? "center" : undefined }}>
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
                                                                        autoSize={{ minRows: 1, maxRows: 8 }}
                                                                        value={cell ?? ""}
                                                                        disabled={readonly}
                                                                        style={center ? { textAlign: "center" } : undefined}
                                                                        onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                    />
                                                                )}
                                                            </td>
                                                            );
                                                        })}
                                                        {!readonly && (
                                                            <td className="pdp-row-op">
                                                                <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(ti, r)} />
                                                                {tb.length > 1 && (
                                                                    <Button type="link" danger size="small" onClick={() => delRow(ti, r)}>删除</Button>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    );
                                })}

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
            <EditableTableGenerator
                open={!!reviewEdit}
                initialData={reviewEdit?.initial}
                onConfirm={saveReviewEdit}
                onCancel={() => setReviewEdit(null)}
            />
        </div>
    );
};
