import { Button, Input, Space, Spin, Tag, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiResearchDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiDocFile from "@/api/ApiDocFile";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

const emptyContent = { sections: [], productName: "" };

// 自动获取（只读）章节的 ref_type 集合；cover/revision 属模板表格，可编辑。
const AUTO_REFS = new Set(["sw_ident", "func_module", "arch_func", "rt_hw", "rt_sw", "rt_net", "update_history", "version_rule"]);
const isAutoNode = (node: any) => AUTO_REFS.has(node?.ref_type) || !!node?.img_category;

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

const removeNode = (nodes: any[], key: string): any[] =>
    (nodes || []).filter((n: any) => n._key !== key).map((n: any) => ({ ...n, children: removeNode(n.children || [], key) }));

const newSection = () => ({ title: "新章节", text: "", images: [], tables: [], table_titles: [], children: [] });

const firstSelectableKey = (nodes: any[]): string => {
    for (const n of nodes || []) {
        if (n.ref_type !== "cover" && n.ref_type !== "revision") return n._key;
        const r = firstSelectableKey(n.children || []);
        if (r) return r;
    }
    return (nodes && nodes[0] && nodes[0]._key) || "";
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
        homeUploading: false,
        imgVer: Date.now(),
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_research_doc({ id }).then((res: any) => {
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
        Api.research_autofill({ product_id: newId }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            // 切换产品：按新产品整体重新获取全部内容（含表5开发量、全文软件名称、版本规则、图等）
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

    const addChild = (key: string) => {
        const next = cloneContent({ sections: data.sections });
        assignKeys(next.sections || []);
        const node = findNode(next.sections || [], key);
        if (!node) return;
        const idx = (node.children || []).length;
        node.children = [...(node.children || []), newSection()];
        assignKeys(next.sections || []);
        dispatch({ sections: next.sections, activeKey: `${key}-${idx}` });
    };
    const addRoot = () => {
        const next = cloneContent({ sections: data.sections });
        const idx = (next.sections || []).length;
        next.sections = [...(next.sections || []), newSection()];
        assignKeys(next.sections);
        dispatch({ sections: next.sections, activeKey: `${idx}` });
    };
    const delNode = (key: string) => {
        const next = cloneContent({ sections: data.sections });
        assignKeys(next.sections || []);
        const remained = removeNode(next.sections || [], key);
        assignKeys(remained);
        const keep = findNode(remained, data.activeKey);
        dispatch({ sections: remained, activeKey: keep ? data.activeKey : firstSelectableKey(remained) });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = cloneContent({ sections: data.sections, productName: data.doc.product_name || "" });
        Api.update_research_doc({
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

    // 上传/替换主界面图：写入该产品「图表文件管理 img_home」，再重新拉取自动获取
    const uploadHomeImage = (file: File) => {
        if (!file.type || !file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const pid = data.doc.product_id;
        if (!pid) {
            message.error("缺少产品信息，无法上传");
            return false;
        }
        dispatch({ homeUploading: true });
        ApiDocFile.list_doc_file("img_home", { product_id: pid, page_index: 0, page_size: 10, _t: Date.now() }).then((res: any) => {
            const rows = (res.code === ApiDocFile.C_OK && res.data?.rows) || [];
            const exist = rows[0];
            const req = exist
                ? ApiDocFile.update_doc_file("img_home", { id: exist.id, product_id: pid, file })
                : ApiDocFile.add_doc_file("img_home", { product_id: pid, file });
            req.then((r: any) => {
                dispatch({ homeUploading: false });
                if (r.code === ApiDocFile.C_OK) {
                    message.success("主界面图已更新");
                    load();
                } else {
                    message.error(r.msg || "上传失败");
                }
            }).catch(() => {
                dispatch({ homeUploading: false });
                message.error("上传失败");
            });
        }).catch(() => {
            dispatch({ homeUploading: false });
            message.error("上传失败");
        });
        return false;
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_research_doc({ id });
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
                    {!readonly && (
                        <span className="pdp-nav-ops" onClick={(e) => e.stopPropagation()}>
                            <PlusOutlined title="添加子章节" onClick={() => addChild(n._key)} />
                            <DeleteOutlined title="删除章节" onClick={() => delNode(n._key)} />
                        </span>
                    )}
                </div>
                {renderNav(n.children || [], depth + 1)}
            </div>
        ));

    const renderImages = (urls: string[], emptyHint?: string) => (
        (urls || []).filter(Boolean).length
            ? (urls || []).filter(Boolean).map((url: string, i: number) => (
                <img key={i} src={url.startsWith("data:") ? url : `${url}${url.includes("?") ? "&" : "?"}_t=${data.imgVer}`} alt={`图${i + 1}`} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "8px 0" }} />
            ))
            : <div style={{ color: "#bbb", margin: "8px 0", fontSize: 13 }}>{emptyHint || "未获取到对应图表，请在「图表文件管理」中按产品上传后重试。"}</div>
    );

    const renderHomeUpload = (hasImg: boolean) => (
        !readonly ? (
            <Upload accept="image/*" showUploadList={false} beforeUpload={(f) => uploadHomeImage(f as File)}>
                <Button size="small" icon={<UploadOutlined />} loading={data.homeUploading} style={{ marginTop: 8 }}>
                    {hasImg ? "更换主界面图" : "上传主界面图"}
                </Button>
            </Upload>
        ) : null
    );

    const renderReadonlyTable = (rows: any[][], title = "") => {
        const cols = Math.max(...(rows || []).map((r) => (r || []).length), 0);
        if (cols <= 0) return null;
        return (
            <>
                {title ? <div style={{ textAlign: "center", fontWeight: 600, fontSize: 13, margin: "4px 0 6px", color: "#1f2d3d" }}>{title}</div> : null}
                <table className="pdp-grid">
                    <tbody>
                        {(rows || []).map((row: any[], ri: number) => (
                            <tr key={ri}>
                                {Array.from({ length: cols }).map((_, ci) => (
                                    <td key={ci} className={ri === 0 ? "head" : ""}>
                                        <div style={{ padding: "4px 8px", whiteSpace: "pre-wrap", fontSize: 13 }}>{(row && row[ci]) ?? ""}</div>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
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

    const renderEditableTable = (rows: any[][], ti: number) => {
        const cols = Math.max(...(rows || []).map((r) => (r || []).length), 0);
        if (cols <= 0) return null;
        const title = (active.table_titles && active.table_titles[ti]) || "";
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
                                    const cellVal = (row && row[ci]) ?? "";
                                    const isSign = typeof cellVal === "string" && cellVal.startsWith("data:image");
                                    return (
                                    <td key={ci} className={ri === 0 ? "head" : ""}>
                                        {isSign ? (
                                            <span style={{ position: "relative", display: "inline-block" }}>
                                                <img src={cellVal} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => updateNode(active._key, (n) => {
                                                    if (!n.tables[ti][ri]) n.tables[ti][ri] = [];
                                                    n.tables[ti][ri][ci] = "";
                                                })} />
                                            </span>
                                        ) : (
                                        <Input.TextArea
                                            className="pdp-cell"
                                            autoSize={{ minRows: 1, maxRows: 8 }}
                                            value={(row && row[ci]) ?? ""}
                                            onChange={(e) => updateNode(active._key, (n) => {
                                                if (!n.tables[ti][ri]) n.tables[ti][ri] = [];
                                                n.tables[ti][ri][ci] = e.target.value;
                                            })}
                                        />
                                        )}
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

    // 表5 开发量：软件名称/开发人员数量/开发时间/工作量 自动计算只读；仅「代码总行数」可手动维护
    const renderDevAmountTable = (rows: any[][], ti: number, title = "") => {
        const cols = Math.max(...(rows || []).map((r) => (r || []).length), 0);
        if (cols <= 0) return null;
        const header = (rows && rows[0]) || [];
        return (
            <>
                {title ? <div style={{ textAlign: "center", fontWeight: 600, fontSize: 13, margin: "4px 0 6px", color: "#1f2d3d" }}>{title}</div> : null}
                <table className="pdp-grid">
                    <tbody>
                        {(rows || []).map((row: any[], ri: number) => (
                            <tr key={ri}>
                                {Array.from({ length: cols }).map((_, ci) => {
                                    const editableCell = !readonly && ri > 0 && String(header[ci] || "").includes("代码总行数");
                                    return (
                                        <td key={ci} className={ri === 0 ? "head" : ""}>
                                            {editableCell ? (
                                                <Input.TextArea
                                                    className="pdp-cell"
                                                    autoSize={{ minRows: 1, maxRows: 4 }}
                                                    value={(row && row[ci]) ?? ""}
                                                    onChange={(e) => updateNode(active._key, (n) => {
                                                        if (!n.tables[ti][ri]) n.tables[ti][ri] = [];
                                                        n.tables[ti][ri][ci] = e.target.value;
                                                    })}
                                                />
                                            ) : (
                                                <div style={{ padding: "4px 8px", whiteSpace: "pre-wrap", fontSize: 13 }}>{(row && row[ci]) ?? ""}</div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>开发人员数量、开发时间、工作量由参与人员与时间线自动计算（只读）；代码总行数可手动维护。</div>
            </>
        );
    };

    // 非自动获取的图文章节：编辑 blocks 里的文字/图题后，按版式重组回 node.text（图位置用 {{IMG}} 占位保留），图保持只读
    const setBlockText = (bi: number, val: string) => updateNode(active._key, (n) => {
        if (!Array.isArray(n.blocks)) return;
        n.blocks[bi] = { ...n.blocks[bi], text: val };
        n.text = n.blocks.map((b: any) => (b?.type === "image" ? "{{IMG}}" : (b?.text ?? ""))).join("\n");
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
                        {editable ? (
                            <Input
                                value={active.title || ""}
                                placeholder="章节标题，如：2.6 xxx"
                                style={{ maxWidth: 480, fontSize: 15, fontWeight: 600 }}
                                onChange={(e) => updateNode(active._key, (n) => { n.title = e.target.value; })}
                            />
                        ) : (
                            <>
                                {active.title}
                                {auto && <Tag color="blue" style={{ marginLeft: 10, fontWeight: 400 }}>自动获取（只读）</Tag>}
                            </>
                        )}
                    </div>
                </div>

                {blocks.length > 0 ? (
                    blocks.map((b: any, bi: number) => {
                        if (b?.type === "image") {
                            const isHome = b.img_category === "img_home";
                            return (
                                <div className="pdp-field" key={bi}>
                                    {renderImages([b.url], isHome ? "未获取到主界面图，请点击下方按钮上传/更换主界面图。" : undefined)}
                                    {isHome && renderHomeUpload(!!b.url)}
                                </div>
                            );
                        }
                        if (b?.type === "caption") {
                            return editable
                                ? <div className="pdp-field" key={bi}><Input size="small" value={b.text ?? ""} placeholder="图题（如：图7 …）" style={{ textAlign: "center", maxWidth: 460 }} onChange={(e) => setBlockText(bi, e.target.value)} /></div>
                                : <div key={bi} style={{ textAlign: "center", fontSize: 13, color: "#444", margin: "4px 0 12px" }}>{b.text}</div>;
                        }
                        if (b?.type === "table") return <div className="pdp-table-block" key={bi}>{renderReadonlyTable(b.table || [], b.title || "")}</div>;
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

                        {((active.images && active.images.length) || active.img_category) ? (
                            <div className="pdp-field">
                                {renderImages(
                                    active.images || [],
                                    active.img_category === "img_home" ? "未获取到主界面图，请点击下方按钮上传/更换主界面图。" : undefined,
                                )}
                                {active.img_category === "img_home" && renderHomeUpload((active.images || []).filter(Boolean).length > 0)}
                            </div>
                        ) : null}

                        {(active.tables || []).map((rows: any[][], ti: number) => {
                            const title = (active.table_titles && active.table_titles[ti]) || "";
                            const isAuto = title.includes("开发量");
                            return (
                                <div className="pdp-table-block" key={ti}>
                                    {isAuto
                                        ? renderDevAmountTable(rows, ti, title)
                                        : (editable ? renderEditableTable(rows, ti) : renderReadonlyTable(rows, title))}
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
                    自研软件研究报告
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
                    <Button onClick={() => navigate("/research_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">蓝色「自动获取」章节由系统按产品自动填充，不可编辑；其余章节可直接修改正文与表格。右侧 + 加子章节、🗑 删除。</div>
                        )}
                        {renderNav(data.sections, 0)}
                        {!readonly && (
                            <Button className="pdp-nav-add" type="dashed" size="small" icon={<PlusOutlined />} onClick={addRoot}>
                                顶级章节
                            </Button>
                        )}
                    </div>

                    <div className="pdp-editor">
                        {renderActive()}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
