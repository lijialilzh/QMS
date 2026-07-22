import { Button, Input, Modal, Space, Spin, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiScsDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewTable from "@/common/ReviewTable";
import "../pdp/PdpDocDetail.less";

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

// 从时间线里找「软件配置状态报告」文件所在行的日期（取最早匹配行），格式「YYYY年M月D日」
const computeFileDate = (rows: any[], keyword = "软件配置状态报告"): string => {
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
        pulling: false,
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

    // 文件修订记录首行默认值：日期/版本/修订说明/修订人/批准人，仅填空格不覆盖已填
    const fillRevision = (nodes: any[], info: { fileDate?: string; version?: string; pm?: string; approver?: string }): any[] => {
        const fix = (n: any): any => {
            const isRev = n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
            let tables = n.tables;
            if (isRev && Array.isArray(n.tables) && Array.isArray(n.tables[0])) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const cols = (t[0] || []).length || 5;
                while (t.length < 6) t.push(new Array(cols).fill(""));
                const row = t[1];
                const setIf = (i: number, val: any) => { if (val && !String(row[i] || "").trim()) row[i] = val; };
                setIf(0, info.fileDate);
                setIf(1, info.version);
                if (!String(row[2] || "").trim()) row[2] = "首次发布";
                setIf(3, info.pm);
                setIf(4, info.approver);
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
                out = fillRevision(out, {
                    fileDate: computeFileDate(tlRows),
                    version,
                    pm: findRole((r) => r.includes("产品经理") || r.includes("经理")),
                    approver: findRole((r) => r.includes("负责人")),
                });
                out = fillMilestone(out, {
                    devEnd: computeDevEnd(tlRows),
                    planDate: latestDateFor(tlRows, ["软件配置状态报告"]),
                    tpm: findRole((r) => r.toUpperCase().includes("TPM")),
                    moduleMap,
                    phases: computeDevPhases(tlRows),
                });
                resolve(out);
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_scs_doc({ id }).then((res: any) => {
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
        const sections = [...data.sections, node];
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
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

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_scs_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_scs_doc({ id });
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
                <div className="pdp-toolbar-title">
                    软件配置状态报告
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
                    <Button onClick={() => navigate("/scs_docs")}>{ts("back")}</Button>
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
                                        placeholder="只填名称，如：开发方法"
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

                                {active.ref_type === "review"
                                    ? (active.tables || []).map((tb: any[], ti: number) => (
                                        <div className="pdp-table-block" key={ti}>
                                            <div className="pdp-table-bar">
                                                <span className="pdp-label">{ti === 0 ? "评审内容" : "参评人员签字"}</span>
                                            </div>
                                            <ReviewTable grid={tb} />
                                        </div>
                                    ))
                                    : (active.tables || []).map((tb: any[], ti: number) => (
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
                                                {tb.map((row: any[], r: number) => (
                                                    <tr key={r}>
                                                        {row.map((cell: any, ci: number) => (
                                                            <td key={ci} className={r === 0 ? "head" : ""}>
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
                                                                        onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                    />
                                                                )}
                                                                {!readonly && r === 0 && tb[0].length > 1 && (
                                                                    <DeleteOutlined className="pdp-col-del" title="删除该列" onClick={() => delCol(ti, ci)} />
                                                                )}
                                                            </td>
                                                        ))}
                                                        {!readonly && (
                                                            <td className="pdp-row-op">
                                                                {tb.length > 1 && (
                                                                    <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}

                                {!readonly && active.ref_type !== "review" && (
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
