import { Button, Input, Space, Spin, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiReleaseNote";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiProdDhf from "@/api/ApiProdDhf";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

// 时间线里找含「发布说明」输出的最早日期行，作为发布时间，格式「YYYY年M月D日」
const computeReleaseDate = (rows: any[], keyword = "发布说明"): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const matches = (rows || []).filter((r: any) =>
        (r.row_type || "date") === "date" && Object.values(r.cells || {}).some((v: any) => String(v || "").includes(keyword))
    );
    if (!matches.length) return "";
    const key = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    let best = matches[0];
    matches.forEach((r: any) => { if (key(r) > key(best)) best = r; });
    return `${num(best.year)}年${num(best.month)}月${num(best.day)}日`;
};

const archiveText = (name: string) =>
    `通过评审，${String(name || "").trim()}的全套设计开发历史文档（DHF）和全套器械主记录（DMR）已完成归档。`;

const overviewText = (name: string, release: string, full: string, funcDesc: string) => {
    const lines = [
        `产品名称：${String(name || "").trim()}`,
        `发布版本：${String(release || "").trim()}`,
        `完整版本：${String(full || "").trim()}`,
        "交付形式：物理交付",
        "存储媒介：U盘",
        "产品功能概述：",
    ];
    const desc = String(funcDesc || "").trim();
    if (desc) lines.push(desc);
    return lines.join("\n");
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

// 找「发布时间」章节节点
const findReleaseNode = (nodes: any[]): any => {
    for (const n of nodes || []) {
        if (n.ref_type === "rn_release_time" || stripNum(n.title) === "发布时间") return n;
        const hit = findReleaseNode(n.children || []);
        if (hit) return hit;
    }
    return null;
};

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

    // 全文自动获取：产品概述(产品名/版本/总体描述)、发布时间、文档归档(产品名)
    const fillAuto = (nodes: any[], info: { overview?: string; releaseDate?: string; archive?: string }): any[] => {
        const fix = (n: any): any => {
            let body = n.body;
            const t = stripNum(n.title);
            if (n.ref_type === "rn_overview" || t === "产品概述") {
                body = info.overview;
            } else if (n.ref_type === "rn_release_time" || t === "发布时间") {
                body = info.releaseDate || "";
            } else if (n.ref_type === "rn_archive" || t === "文档归档") {
                if (info.archive) body = info.archive;
            }
            return { ...n, body, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 文件修订记录首行（仅填空、不覆盖已填）
    const fillRevision = (nodes: any[], info: { fileDate?: string; version?: string; pm?: string; approver?: string }): any[] => {
        const fix = (n: any): any => {
            const isRev = n.ref_type === "revision" || stripNum(n.title) === "文件修订记录";
            let tables = n.tables;
            if (isRev && Array.isArray(n.tables) && Array.isArray(n.tables[0])) {
                const tb = n.tables[0].map((r: any[]) => (Array.isArray(r) ? [...r] : r));
                const cols = (tb[0] || []).length || 5;
                while (tb.length < 6) tb.push(new Array(cols).fill(""));
                const row = tb[1];
                while (row.length < 5) row.push("");
                row[0] = info.fileDate || "";
                if (info.version) row[1] = info.version;
                if (!String(row[2] || "").trim()) row[2] = "首次发布";
                row[3] = info.pm || "";
                if (info.approver) row[4] = info.approver;
                tables = [tb, ...n.tables.slice(1)];
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 移交记录：文件编号按 DHF 自动获取
    // - 文件移交记录(3.4.2)：表头含「文件编号/文件名称」，按名称列填编号列
    // - 产品移交记录(3.4.1)：单格形如「编号 文档名」或纯「文档名」，按文档名取 DHF 最新编号重建
    const fillTransferFiles = (nodes: any[], dhfMap: Record<string, string>, acceptanceDate: string): any[] => {
        const codeOf = (name: string): string => {
            const k = String(name || "").trim();
            if (!k) return "";
            if (dhfMap[k]) return dhfMap[k];
            const hit = Object.keys(dhfMap).find((n) => n.includes(k) || k.includes(n));
            return hit ? dhfMap[hit] : "";
        };
        // 把「编号 文档名」/「文档名」单元格按 DHF 重建为「最新编号 文档名」（保留原文档名文案）
        const resolveCell = (val: any): any => {
            const s = String(val || "").trim();
            if (!s) return val;
            const m = s.match(/^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s+(\S.*)$/);
            if (m) {
                const name = m[2].trim();
                const code = codeOf(name);
                return code ? `${code} ${name}` : val;
            }
            if (dhfMap[s]) return `${dhfMap[s]} ${s}`;
            return val;
        };
        const fix = (n: any): any => {
            const title = stripNum(n.title);
            const isFileRec = n.ref_type === "rn_transfer_files" || title === "文件移交记录";
            const isProdRec = n.ref_type === "rn_transfer_product" || title === "产品移交记录";
            let tables = n.tables;
            if (isFileRec && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) => {
                    if (!Array.isArray(tb) || !tb.length) return tb;
                    const header = tb[0] || [];
                    const isFileTbl = header.some((h: any) => String(h).includes("文件编号")) && header.some((h: any) => String(h).includes("文件名称"));
                    if (!isFileTbl) return tb;
                    return tb.map((row: any[], ri: number) => {
                        if (ri === 0 || !Array.isArray(row) || row.length < 2) return row;
                        const code = codeOf(row[1]);
                        if (!code) return row;
                        const next = [...row];
                        next[0] = code;
                        return next;
                    });
                });
            } else if (isProdRec && Array.isArray(n.tables)) {
                tables = n.tables.map((tb: any[]) => {
                    if (!Array.isArray(tb)) return tb;
                    return tb.map((row: any[]) => {
                        if (!Array.isArray(row)) return row;
                        const next = row.map((cell: any) => resolveCell(cell));
                        // 交付时间：取时间线「产品验收记录」日期，取不到则清空
                        if (next.length > 2 && String(next[1] || "").includes("交付时间")) {
                            next[2] = acceptanceDate || "";
                        }
                        return next;
                    });
                });
            }
            return { ...n, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    const autofill = (productId: number, secs: any[], version: string): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiTimeline.list_timeline({ prod_id: productId }).catch(() => null),
                ApiMember.list_project_member({ prod_id: productId, page_index: 0, page_size: 1000 }).catch(() => null),
                ApiProdDhf.list_prod_dhf({ prod_id: productId, page_index: 0, page_size: 10000 }).catch(() => null),
            ]).then(([pr, tl, mb, dh]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const dhfRows = dh && dh.code === Api.C_OK ? ((dh.data && dh.data.rows) || []) : [];
                const dhfMap: Record<string, string> = {};
                dhfRows.forEach((d: any) => {
                    const name = String(d.name || "").trim();
                    if (name && d.code) dhfMap[name] = String(d.code).trim();
                });
                const findRole = (pred: (role: string) => boolean) => {
                    const hit = members.find((m: any) => pred(String(m.role || "")));
                    return hit ? String(hit.name || "").trim() : "";
                };
                const releaseDate = computeReleaseDate(tlRows);
                const acceptanceDate = computeReleaseDate(tlRows, "产品验收记录");
                let out = fillAuto(secs, {
                    overview: overviewText(prod.name, prod.release_version, prod.full_version, prod.overall_desc),
                    releaseDate,
                    archive: archiveText(prod.name),
                });
                out = fillRevision(out, {
                    fileDate: releaseDate,
                    version,
                    pm: findRole((r) => r.includes("产品经理")),
                    approver: findRole((r) => r.includes("负责人") && r.includes("产品")),
                });
                out = fillTransferFiles(out, dhfMap, acceptanceDate);
                resolve(out);
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_release_note({ id }).then((res: any) => {
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
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        autofill(newId, data.sections, data.doc.version).then((secs) => {
            dispatch({ loading: false, sections: secs });
            const rt = findReleaseNode(secs);
            if (!rt || !String(rt.body || "").trim()) {
                message.warning("该产品未查询到对应时间线，发布时间已清空");
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
        Api.update_release_note({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success(ts("save_success"));
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_release_note({ id });
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
                    产品发布说明
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
                    <Button onClick={() => navigate("/release_notes")}>{ts("back")}</Button>
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
                                        placeholder="只填名称，如：发布时间"
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
