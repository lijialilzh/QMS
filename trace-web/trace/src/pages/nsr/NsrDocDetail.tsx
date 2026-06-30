import { Button, Input, Space, Spin, Tag, message } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiNsrDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

const emptyContent = { sections: [], productName: "" };

// 自动获取（只读）章节的 ref_type 集合；cover/revision 属模板表格，可编辑。
const AUTO_REFS = new Set(["sw_info", "cyber_haz", "cyber_trace", "risk_matrix"]);
const isAutoNode = (node: any) => AUTO_REFS.has(node?.ref_type);

// 2.1 风险分布矩阵固定结构（严格按原 Word）
const RISK_PROB_ROWS: [string, string][] = [["经常", "5"], ["有时", "4"], ["偶然", "3"], ["很少", "2"], ["非常少", "1"]];
const RISK_SEV_COLS: [string, string][] = [["可忽略", "A"], ["轻度", "B"], ["严重", "C"], ["危重的", "D"], ["灾难性的", "E"]];
const RISK_COLOR: string[][] = [
    ["R", "R", "R", "R", "R"],
    ["R", "R", "R", "R", "R"],
    ["O", "O", "R", "R", "R"],
    ["G", "G", "O", "R", "R"],
    ["G", "G", "O", "O", "R"],
];
const RISK_HEX: Record<string, string> = { R: "#FF0000", O: "#FFC000", G: "#00B050" };
const RISK_LEGEND: [string, string, string][] = [
    ["R", "红色", "不可接受：这类风险本质上不可接受。必须寻求风险降低措施，"],
    ["O", "橙色", "进一步降低的研究：这类风险必须降低到合理可行的最低限度才可视为可接受"],
    ["G", "绿色", "可忽略：这些风险本质上是可以接受的。即使它可以忽略不计，推想也需要尽可能地降低风险"],
];

const renderRiskMatrix = (m: any) => {
    const counts: number[][] = (m && m.counts) || Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    const rowTotals: number[] = (m && m.row_totals) || [0, 0, 0, 0, 0];
    const colTotals: number[] = (m && m.col_totals) || [0, 0, 0, 0, 0];
    const total = (m && m.total) || 0;
    const bd = "1px solid #999";
    const th: CSSProperties = { border: bd, padding: "4px 10px", textAlign: "center", fontWeight: 600, background: "#f5f5f5", whiteSpace: "nowrap" };
    const totalCell: CSSProperties = { border: bd, padding: "4px 10px", textAlign: "center", fontWeight: 600 };
    const numCell = (key: string): CSSProperties => ({ border: bd, padding: "4px 10px", textAlign: "center", fontWeight: 600, background: RISK_HEX[key], color: "#7a0000" });
    return (
        <div>
            <table style={{ borderCollapse: "collapse", fontSize: 13, margin: "4px 0 8px" }}>
                <tbody>
                    <tr>
                        <th style={th} colSpan={3} rowSpan={3}>风险值</th>
                        <th style={th} colSpan={5}>严重度</th>
                        <th style={th} rowSpan={3}>总计</th>
                    </tr>
                    <tr>{RISK_SEV_COLS.map(([n], i) => <th key={i} style={th}>{n}</th>)}</tr>
                    <tr>{RISK_SEV_COLS.map(([, l], i) => <th key={i} style={th}>{l}</th>)}</tr>
                    {RISK_PROB_ROWS.map(([pname, pnum], ri) => (
                        <tr key={ri}>
                            {ri === 0 && <th style={th} rowSpan={5}>发生概率</th>}
                            <th style={th}>{pname}</th>
                            <th style={th}>{pnum}</th>
                            {counts[ri].map((v, ci) => <td key={ci} style={numCell(RISK_COLOR[ri][ci])}>{v}</td>)}
                            <td style={totalCell}>{rowTotals[ri]}</td>
                        </tr>
                    ))}
                    <tr>
                        <th style={th} colSpan={3}>总计</th>
                        {colTotals.map((v, ci) => <td key={ci} style={totalCell}>{v}</td>)}
                        <td style={totalCell}>{total}</td>
                    </tr>
                    {RISK_LEGEND.map(([key, label, desc], i) => (
                        <tr key={"lg" + i}>
                            <td style={{ border: bd, padding: "4px 12px", textAlign: "center", fontWeight: 600, background: RISK_HEX[key], color: "#7a0000", whiteSpace: "nowrap" }}>{label}</td>
                            <td colSpan={8} style={{ border: bd, padding: "4px 12px" }}>{desc}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const assignKeys = (nodes: any[], prefix = ""): any[] => {
    (nodes || []).forEach((n: any, i: number) => {
        n._key = `${prefix}${i}`;
        assignKeys(n.children || [], `${n._key}-`);
    });
    return nodes || [];
};

const findNode = (nodes: any[], key: string): any => {
    for (const n of nodes || []) {
        if (n._key === key) return n;
        const r = findNode(n.children || [], key);
        if (r) return r;
    }
    return null;
};

const cloneContent = (content: any) => JSON.parse(JSON.stringify(content || emptyContent));

const firstSelectableKey = (nodes: any[]): string => {
    for (const n of nodes || []) {
        if (n.ref_type !== "cover" && n.ref_type !== "revision") return n._key;
        const r = firstSelectableKey(n.children || []);
        if (r) return r;
    }
    return (nodes && nodes[0] && nodes[0]._key) || "";
};

// 计算每列纵向连续相同（非空）单元格的合并跨度：返回 span[ri][ci]，>1 为合并起始行的跨度，0 为被合并跳过，1 为普通格。表头行(0)不合并。
const computeSpans = (rows: any[][], cols: number): number[][] => {
    const n = (rows || []).length;
    const span: number[][] = Array.from({ length: n }, () => new Array(cols).fill(1));
    const val = (r: number, c: number) => String((rows[r] && rows[r][c]) ?? "");
    for (let ci = 0; ci < cols; ci++) {
        let ri = 1;
        while (ri < n) {
            if (val(ri, ci) === "") { ri += 1; continue; }
            let rj = ri + 1;
            while (rj < n && val(rj, ci) === val(ri, ci)) rj += 1;
            span[ri][ci] = rj - ri;
            for (let k = ri + 1; k < rj; k++) span[k][ci] = 0;
            ri = rj;
        }
    }
    return span;
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
        imgVer: Date.now(),
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_nsr_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const content = doc.content || emptyContent;
            const sections = content.sections || [];
            assignKeys(sections);
            dispatch({
                loading: false,
                doc,
                sections,
                imgVer: Date.now(),
                activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstSelectableKey(sections),
            });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        Api.nsr_autofill({ product_id: newId }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            // 切换产品：按新产品整体重新获取全部内容（含软件信息、全文软件名称等）
            const sections = (res.data && res.data.sections) || [];
            assignKeys(sections);
            dispatch({
                loading: false,
                sections,
                imgVer: Date.now(),
                activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstSelectableKey(sections),
            });
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

    const updateNode = (key: string, updater: (n: any) => void) => {
        const next = cloneContent({ sections: data.sections });
        assignKeys(next.sections || []);
        const node = findNode(next.sections || [], key);
        if (node) {
            updater(node);
            dispatch({ sections: next.sections });
        }
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = cloneContent({ sections: data.sections, productName: data.doc.product_name || "" });
        Api.update_nsr_doc({
            id,
            content,
            product_id: data.doc.product_id,
            version: data.doc.version,
        }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                load();
            } else {
                message.error(res.msg);
            }
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_nsr_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const active = findNode(data.sections, data.activeKey);

    const renderNav = (nodes: any[], depth: number) =>
        (nodes || []).map((n: any) => (
            <div key={n._key}>
                <div
                    className={`pdp-nav-item${n._key === data.activeKey ? " active" : ""}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => dispatch({ activeKey: n._key })}>
                    <span className="pdp-nav-title" title={n.title}>{n.title || "(未命名)"}</span>
                </div>
                {renderNav(n.children || [], depth + 1)}
            </div>
        ));

    const renderImages = (urls: string[], emptyHint?: string) => (
        (urls || []).filter(Boolean).length
            ? (urls || []).filter(Boolean).map((url: string, i: number) => (
                <img key={i} src={url.startsWith("data:") ? url : `${url}${url.includes("?") ? "&" : "?"}_t=${data.imgVer}`} alt={`图${i + 1}`} style={{ maxWidth: 360, maxHeight: 460, width: "auto", height: "auto", display: "block", margin: "8px 0" }} />
            ))
            : <div style={{ color: "#bbb", margin: "8px 0", fontSize: 13 }}>{emptyHint || "未获取到对应图表。"}</div>
    );

    const renderReadonlyTable = (rows: any[][], title = "", noMerge = false) => {
        const cols = Math.max(...(rows || []).map((r) => (r || []).length), 0);
        if (cols <= 0) return null;
        const span = noMerge ? null : computeSpans(rows, cols);
        // 宽表（如附录A 16列 / 附录C 10列）：横向滚动，列给最小/最大宽度，避免被压成逐字换行
        const wide = cols >= 8;
        const cellStyle: CSSProperties = { padding: "4px 8px", whiteSpace: "pre-wrap", fontSize: 13, textAlign: "left" };
        if (wide) { cellStyle.minWidth = 84; cellStyle.maxWidth = 220; }
        return (
            <>
                {title ? <div style={{ textAlign: "center", fontWeight: 600, fontSize: 13, margin: "4px 0 6px", color: "#1f2d3d" }}>{title}</div> : null}
                <div style={wide ? { overflowX: "auto", maxWidth: "100%" } : undefined}>
                    <table className="pdp-grid" style={wide ? { tableLayout: "auto", width: "max-content", minWidth: "100%" } : undefined}>
                        <tbody>
                            {(rows || []).map((row: any[], ri: number) => (
                                <tr key={ri}>
                                    {Array.from({ length: cols }).map((_, ci) => {
                                        const sp = span ? span[ri][ci] : 1;
                                        if (sp === 0) return null;
                                        const merged = sp > 1;
                                        return (
                                            <td key={ci} rowSpan={sp} className={ri === 0 ? "head" : ""} style={{ border: "1px solid #c4ccd4", ...(merged ? { verticalAlign: "middle" } : {}) }}>
                                                <div style={cellStyle}>{(row && row[ci]) ?? ""}</div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </>
        );
    };

    const addRow = (ti: number) => updateNode(active._key, (n) => {
        const tb = n.tables[ti] || [];
        const cols = (tb[0] || []).length || 1;
        tb.push(new Array(cols).fill(""));
        n.tables[ti] = tb;
    });
    const addCol = (ti: number) => updateNode(active._key, (n) => {
        n.tables[ti] = (n.tables[ti] || []).map((row: any[]) => [...(row || []), ""]);
    });
    const delRow = (ti: number, r: number) => updateNode(active._key, (n) => {
        n.tables[ti] = (n.tables[ti] || []).filter((_: any, i: number) => i !== r);
    });
    const delCol = (ti: number, ci: number) => updateNode(active._key, (n) => {
        n.tables[ti] = (n.tables[ti] || []).map((row: any[]) => (row || []).filter((_: any, i: number) => i !== ci));
    });

    const setTableTitle = (ti: number, val: string) => updateNode(active._key, (n) => {
        const titles = Array.isArray(n.table_titles) ? n.table_titles.slice() : [];
        while (titles.length <= ti) titles.push("");
        titles[ti] = val;
        n.table_titles = titles;
    });

    const renderEditableTable = (rows: any[][], ti: number, noMerge = false) => {
        const cols = Math.max(...(rows || []).map((r) => (r || []).length), 0);
        if (cols <= 0) return null;
        const title = (active.table_titles && active.table_titles[ti]) || "";
        const span = noMerge ? null : computeSpans(rows, cols);
        return (
            <>
                <div className="pdp-table-bar">
                    <Input
                        size="small"
                        style={{ maxWidth: 360, fontWeight: 600 }}
                        value={title}
                        placeholder={`表名（如：表${ti + 1} xxx），显示在表格上方`}
                        onChange={(e) => setTableTitle(ti, e.target.value)}
                    />
                    <Space size={4}>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => addRow(ti)}>行</Button>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => addCol(ti)}>列</Button>
                    </Space>
                </div>
                <table className="pdp-grid">
                    <tbody>
                        {(rows || []).map((row: any[], ri: number) => (
                            <tr key={ri}>
                                {Array.from({ length: cols }).map((_, ci) => {
                                    const rs = span ? span[ri][ci] : 1;
                                    if (rs === 0) return null;
                                    const merged = rs > 1;
                                    return (
                                        <td key={ci} rowSpan={rs} className={ri === 0 ? "head" : ""} style={{ border: "1px solid #c4ccd4", ...(merged ? { verticalAlign: "middle" } : {}) }}>
                                            <Input.TextArea
                                                className="pdp-cell"
                                                style={{ textAlign: "left" }}
                                                autoSize={{ minRows: 1, maxRows: 8 }}
                                                value={(row && row[ci]) ?? ""}
                                                onChange={(e) => updateNode(active._key, (n) => {
                                                    const v = e.target.value;
                                                    for (let k = 0; k < rs; k++) {
                                                        if (!n.tables[ti][ri + k]) n.tables[ti][ri + k] = [];
                                                        n.tables[ti][ri + k][ci] = v;
                                                    }
                                                })}
                                            />
                                            {ri === 0 && cols > 1 && (
                                                <DeleteOutlined className="pdp-col-del" title="删除该列" onClick={() => delCol(ti, ci)} />
                                            )}
                                        </td>
                                    );
                                })}
                                <td className="pdp-row-op">
                                    {(rows || []).length > 1 && (
                                        <DeleteOutlined title="删除该行" onClick={() => delRow(ti, ri)} />
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </>
        );
    };

    // 非自动获取的图文章节：编辑 blocks 里的文字/图题后，按版式重组回 node.text（图用 {{IMG}}、表用 {{TABLE:n}} 占位保留位置），图与表数据另存于 node.images/tables
    const setBlockText = (bi: number, val: string) => updateNode(active._key, (n) => {
        if (!Array.isArray(n.blocks)) return;
        n.blocks[bi] = { ...n.blocks[bi], text: val };
        n.text = n.blocks.map((b: any) => (
            b?.type === "image" ? "{{IMG}}"
                : b?.type === "table" ? `{{TABLE:${b.table_index}}}`
                    : (b?.text ?? "")
        )).join("\n");
    });

    const renderActive = () => {
        if (!active) return <div className="pdp-empty">请选择左侧章节</div>;
        const auto = isAutoNode(active);
        const editable = !readonly && !auto;
        const blocks: any[] = Array.isArray(active.blocks) ? active.blocks : [];

        return (
            <>
                <div className="pdp-field">
                    <div className="pdp-label" style={{ fontSize: 15, color: "#1f2d3d" }}>
                        {active.title}
                        {auto && <Tag color="blue" style={{ marginLeft: 10, fontWeight: 400 }}>自动获取（只读）</Tag>}
                    </div>
                </div>

                {blocks.length > 0 ? (
                    blocks.map((b: any, bi: number) => {
                        if (b?.type === "image") {
                            return <div className="pdp-field" key={bi}>{renderImages([b.url])}</div>;
                        }
                        if (b?.type === "risk_matrix") {
                            return <div className="pdp-table-block" key={bi}>{renderRiskMatrix(b.matrix)}</div>;
                        }
                        if (b?.type === "caption") {
                            return editable
                                ? <div className="pdp-field" key={bi}><Input size="small" value={b.text ?? ""} placeholder="图题（如：图1 …）" style={{ textAlign: "center", maxWidth: 460 }} onChange={(e) => setBlockText(bi, e.target.value)} /></div>
                                : <div key={bi} style={{ textAlign: "center", fontSize: 13, color: "#444", margin: "4px 0 12px" }}>{b.text}</div>;
                        }
                        if (b?.type === "table") {
                            const ti = b.table_index;
                            const hasIdx = typeof ti === "number";
                            const rows = hasIdx && active.tables && active.tables[ti] ? active.tables[ti] : (b.table || []);
                            const title = (hasIdx && active.table_titles && active.table_titles[ti]) || b.title || "";
                            const noMerge = !!b.no_merge;
                            return <div className="pdp-table-block" key={bi}>{editable && hasIdx ? renderEditableTable(rows, ti, noMerge) : renderReadonlyTable(rows, title, noMerge)}</div>;
                        }
                        if (editable) {
                            return <div className="pdp-field" key={bi}><Input.TextArea autoSize={{ minRows: 2, maxRows: 20 }} value={b?.text ?? ""} placeholder="本段正文内容，可多行" onChange={(e) => setBlockText(bi, e.target.value)} /></div>;
                        }
                        return b?.text
                            ? <div className="pdp-field" key={bi} style={{ whiteSpace: "pre-wrap", color: "#46586b", fontSize: 13, lineHeight: 1.7 }}>{b.text}</div>
                            : null;
                    })
                ) : (
                    <>
                        <div className="pdp-field">
                            {editable ? (
                                <Input.TextArea
                                    autoSize={{ minRows: 3, maxRows: 20 }}
                                    value={active.text ?? ""}
                                    placeholder="本章节正文内容，可多行"
                                    onChange={(e) => updateNode(active._key, (n) => { n.text = e.target.value; })}
                                />
                            ) : (
                                active.text
                                    ? <div style={{ whiteSpace: "pre-wrap", color: "#46586b", fontSize: 13, lineHeight: 1.7 }}>{active.text}</div>
                                    : <div style={{ color: "#bbb", fontSize: 13 }}>（暂无内容）</div>
                            )}
                        </div>

                        {(active.images && active.images.length) ? (
                            <div className="pdp-field">{renderImages(active.images || [])}</div>
                        ) : null}

                        {(active.tables || []).map((rows: any[][], ti: number) => {
                            const title = (active.table_titles && active.table_titles[ti]) || "";
                            const noMerge = active.ref_type === "cover" || active.ref_type === "revision";
                            return (
                                <div className="pdp-table-block" key={ti}>
                                    {editable ? renderEditableTable(rows, ti, noMerge) : renderReadonlyTable(rows, title, noMerge)}
                                </div>
                            );
                        })}
                    </>
                )}
            </>
        );
    };

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    自研软件网络安全研究报告
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
                    <Button onClick={() => navigate("/nsr_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">蓝色「自动获取」章节由系统按产品自动填充，不可编辑；其余章节可直接修改正文与表格。</div>
                        )}
                        {renderNav(data.sections, 0)}
                    </div>

                    <div className="pdp-editor">
                        {renderActive()}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
