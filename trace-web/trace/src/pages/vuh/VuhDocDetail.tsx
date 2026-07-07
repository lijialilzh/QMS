import { Button, Input, Space, Spin, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiVuhDoc";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiVersionRule from "@/api/ApiVersionRule";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

// 由「基础数据-版本命名规则」全局配置生成「软件版本命名规则」章节正文
const buildNamingBody = (c: any): string => {
    c = c || {};
    const items = Array.isArray(c.items) ? c.items : [];
    const lines: string[] = [
        "软件版本命名规则为：",
        `发布版本：${c.release_format || ""}`,
        `完整版本：${c.full_format || ""}`,
        "软件完整版本及说明：",
    ];
    if (String(c.note_top || "").trim()) lines.push(c.note_top);
    items.forEach((it: any) => {
        const title = String(it.title || "").trim();
        const desc = String(it.desc || "").trim();
        if (title || desc) lines.push(`${title}：${desc}`);
    });
    if (String(c.note_bottom || "").trim()) lines.push(c.note_bottom);
    return lines.join("\n");
};

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// 从时间线里找「版本更新历史」文件所在行的日期（取最早匹配行）
const findFileRow = (rows: any[], keyword = "版本更新历史"): any => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const matches = (rows || []).filter((r: any) =>
        (r.row_type || "date") === "date" && Object.values(r.cells || {}).some((v: any) => String(v || "").includes(keyword))
    );
    if (!matches.length) return null;
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) < key(best)) best = r; });
    return best;
};
const computeFileDate = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const best = findFileRow(rows);
    return best ? `${num(best.year)}年${num(best.month)}月${num(best.day)}日` : "";
};
const computeReleaseDate = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const best = findFileRow(rows);
    return best ? `${num(best.year)}.${pad(num(best.month))}.${pad(num(best.day) || 1)}` : "";
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

// 「软件版本命名规则」章节的固定示意图（只读，仅展示用）
const NamingRuleDiagram = () => (
    <svg viewBox="0 0 470 290" style={{ width: 470, maxWidth: "100%", margin: "4px 0 8px" }}>
        <defs>
            <marker id="vuh-vr-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,3 L0,6 Z" fill="#333" />
            </marker>
        </defs>
        <rect x="10" y="12" width="210" height="44" fill="none" stroke="#333" />
        <text x="45" y="43" fontSize="20" fontWeight="700" textAnchor="middle">X</text>
        <text x="68" y="43" fontSize="20" textAnchor="middle">.</text>
        <text x="95" y="43" fontSize="20" fontWeight="700" textAnchor="middle">Y</text>
        <text x="118" y="43" fontSize="20" textAnchor="middle">.</text>
        <text x="145" y="43" fontSize="20" fontWeight="700" textAnchor="middle">Z</text>
        <text x="168" y="43" fontSize="20" textAnchor="middle">.</text>
        <text x="195" y="43" fontSize="20" fontWeight="700" textAnchor="middle">B</text>
        <polyline points="195,56 195,87 300,87" fill="none" stroke="#333" markerEnd="url(#vuh-vr-arrow)" />
        <polyline points="145,56 145,142 300,142" fill="none" stroke="#333" markerEnd="url(#vuh-vr-arrow)" />
        <polyline points="95,56 95,197 300,197" fill="none" stroke="#333" markerEnd="url(#vuh-vr-arrow)" />
        <polyline points="45,56 45,252 300,252" fill="none" stroke="#333" markerEnd="url(#vuh-vr-arrow)" />
        <g fontSize="13" textAnchor="middle">
            <rect x="302" y="70" width="150" height="34" fill="none" stroke="#333" />
            <text x="377" y="92">上市后软件升级次数号</text>
            <rect x="302" y="125" width="150" height="34" fill="none" stroke="#333" />
            <text x="377" y="147">修订版本号</text>
            <rect x="302" y="180" width="150" height="34" fill="none" stroke="#333" />
            <text x="377" y="202">次版本号</text>
            <rect x="302" y="235" width="150" height="34" fill="none" stroke="#333" />
            <text x="377" y="257">主版本号</text>
        </g>
    </svg>
);

const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "revision") {
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

    // 版本信息：自动获取产品名/发布版本/完整版本（始终取最新覆盖，源为空时保留原值）
    const fillVersionInfo = (nodes: any[], info: { name?: string; releaseVersion?: string; fullVersion?: string }): any[] => {
        const name = String(info.name || "").trim();
        const rel = String(info.releaseVersion || "").trim();
        const full = String(info.fullVersion || "").trim();
        const fix = (n: any): any => {
            let body = n.body;
            const t = stripNum(n.title);
            if (n.ref_type === "version_info" || t === "版本信息") {
                if (name || rel || full) {
                    body = `本次软件为首次注册，软件完整版本为${full}，发布版本为${rel}。\n产品名称：${name}\n发布版本：${rel}\n完整版本：${full}`;
                }
            }
            return { ...n, body, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 软件版本命名规则：从全局「版本命名规则」配置始终取最新覆盖
    const fillNamingRule = (nodes: any[], body: string): any[] => {
        if (!body) return nodes;
        const fix = (n: any): any => {
            const b = stripNum(n.title) === "软件版本命名规则" ? body : n.body;
            return { ...n, body: b, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 软件开发阶段更新历史表首行：完整版本/发布版本/首次发布/发布日期/首次发布（仅填空不覆盖）
    const fillUpdateHistory = (nodes: any[], info: { fullVersion?: string; releaseVersion?: string; releaseDate?: string }): any[] => {
        const fix = (n: any): any => {
            const isUh = n.ref_type === "update_history" || stripNum(n.title) === "软件开发阶段更新历史";
            let tables = n.tables;
            if (isUh && Array.isArray(n.tables) && Array.isArray(n.tables[0]) && n.tables[0].length >= 2) {
                const t = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const row = t[1];
                const setIf = (i: number, val: any) => { if (val && i < row.length && !String(row[i] || "").trim()) row[i] = val; };
                setIf(0, info.fullVersion);
                setIf(1, info.releaseVersion);
                if (row.length > 2 && !String(row[2] || "").trim()) row[2] = "首次发布";
                setIf(3, info.releaseDate);
                if (row.length > 4 && !String(row[4] || "").trim()) row[4] = "首次发布";
                tables = [t, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 文件修订记录首行默认值（仅填空不覆盖）
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

    // 按产品重新获取并填充所有自动获取内容（版本信息/命名规则/更新历史/文件修订记录）
    const autofill = (productId: number, secs: any[], version: string): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiVersionRule.get_version_rule().catch(() => null),
            ]).then(([pr, tl, mb, vr]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const vrContent = vr && vr.code === Api.C_OK ? (vr.data && vr.data.content) : null;
                const findRole = (pred: (role: string) => boolean) => {
                    const hit = members.find((m: any) => pred(String(m.role || "")));
                    return hit ? String(hit.name || "").trim() : "";
                };
                let out = fillVersionInfo(secs, {
                    name: prod.name,
                    releaseVersion: prod.release_version,
                    fullVersion: prod.full_version,
                });
                if (vrContent) out = fillNamingRule(out, buildNamingBody(vrContent));
                out = fillUpdateHistory(out, {
                    fullVersion: prod.full_version,
                    releaseVersion: prod.release_version,
                    releaseDate: computeReleaseDate(tlRows),
                });
                out = fillRevision(out, {
                    fileDate: computeFileDate(tlRows),
                    version,
                    pm: findRole((r) => r.includes("产品经理")),
                    approver: findRole((r) => r.includes("负责人") && r.includes("产品")),
                });
                resolve(out);
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_vuh_doc({ id }).then((res: any) => {
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

    // 修改产品名称/版本后，重新拉取并填充所有自动获取内容（保留人工编辑的非自动字段）
    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, data.doc.version).then((secs) => dispatch({ loading: false, sections: secs }));
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

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_vuh_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                load();
            } else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_vuh_doc({ id });
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
                    版本更新历史
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
                    <Button onClick={() => navigate("/vuh_docs")}>{ts("back")}</Button>
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
                                        placeholder="只填名称，如：版本信息"
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

                                {stripNum(active.title) === "软件版本命名规则" && (
                                    <div className="pdp-field">
                                        <div className="pdp-label">软件完整版本及说明（示意图，导出自动包含）</div>
                                        <NamingRuleDiagram />
                                    </div>
                                )}

                                {(active.tables || []).map((tb: any[], ti: number) => (
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
