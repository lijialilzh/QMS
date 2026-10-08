import { Button, Input, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiRmpDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";
import { syncDocVersionFields } from "@/pages/doc_fill/syncDocVersion";

let _seq = 0;
const genKey = () => `r${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const showExponent = (text: any): string =>
    String(text ?? "").replace(/10-(\d)(?!\d)/g, (_m, d) => `10⁻${SUP_DIGITS[Number(d)] || d}`);

const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n,
        _key: n._key || genKey(),
        body: showExponent(n.body ?? ""),
        ...(n.body_after != null ? { body_after: showExponent(n.body_after) } : {}),
        tables: (Array.isArray(n.tables) ? n.tables : []).map((tb: any[]) =>
            (tb || []).map((row: any[]) =>
                (row || []).map((c: any) => (typeof c === "string" && !c.startsWith("data:image") ? showExponent(c) : c))
            )
        ),
        images: Array.isArray(n.images) ? n.images : [],
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

const isTeamTable = (tb: any[]): boolean => {
    const header = (tb?.[0] || []).slice(0, 3).map((c: any) => String(c ?? "").trim());
    return header[0] === "项目角色" && header[1] === "姓名" && header[2] === "职责";
};

const mergeCellText = (cell: any): string => {
    const text = String(cell ?? "").trim();
    if (!text || text.startsWith("data:image")) return "";
    return text;
};

// 相邻且内容相同的格子合并：先横向，再向下扩展成同样宽的矩形。空单元格、签名图不参与。
const duplicateMerges = (tb: any[], rowBlocked?: (row: any[]) => boolean) => {
    const n = (tb || []).length;
    const cols = Math.max(0, ...(tb || []).map((row: any[]) => (row || []).length));
    const used = Array.from({ length: n }, () => Array(cols).fill(false));
    const anchors: Record<string, { rs: number; cs: number }> = {};
    const skip = new Set<string>();
    for (let r = 0; r < n; r++) {
        if (rowBlocked && rowBlocked(tb[r] || [])) {
            for (let c = 0; c < cols; c++) used[r][c] = true;
        }
    }
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < cols; c++) {
            if (used[r][c]) continue;
            const val = mergeCellText(tb[r]?.[c]);
            if (!val) {
                used[r][c] = true;
                continue;
            }
            let w = 1;
            while (c + w < cols && !used[r][c + w] && mergeCellText(tb[r]?.[c + w]) === val) w += 1;
            let h = 1;
            while (r + h < n) {
                let ok = true;
                for (let k = 0; k < w; k++) {
                    if (used[r + h][c + k] || mergeCellText(tb[r + h]?.[c + k]) !== val) {
                        ok = false;
                        break;
                    }
                }
                if (ok && c + w < cols && !used[r + h][c + w] && mergeCellText(tb[r + h]?.[c + w]) === val) ok = false;
                if (!ok) break;
                h += 1;
            }
            for (let rr = r; rr < r + h; rr++) {
                for (let cc = c; cc < c + w; cc++) used[rr][cc] = true;
            }
            if (h > 1 || w > 1) {
                anchors[`${r},${c}`] = { rs: h, cs: w };
                for (let rr = r; rr < r + h; rr++) {
                    for (let cc = c; cc < c + w; cc++) {
                        if (rr !== r || cc !== c) skip.add(`${rr},${cc}`);
                    }
                }
            }
        }
    }
    return { anchors, skip };
};

// 编号：封面/修订记录/附录不编号；其余正文顶级 1/2/3，子级 1.1...
const NO_NUM = new Set(["cover", "revision", "appendix"]);
const walkChildren = (nodes: any[], prefix: string, map: Record<string, string>) => {
    let idx = 0;
    (nodes || []).forEach((n: any) => {
        idx += 1;
        const num = prefix ? `${prefix}.${idx}` : `${idx}`;
        map[n._key] = num;
        walkChildren(n.children || [], num, map);
    });
};
const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (NO_NUM.has(n.ref_type)) {
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

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_rmp_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = ensureKeys((doc.content && doc.content.sections) || []);
            dispatch({ loading: false, doc, sections: syncDocVersionFields(sections, doc.version), activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstKey(sections) });
        });
    };

    // 切换产品：拉取默认内容并自动填充该产品信息（重置为模板）
    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        Api.rmp_autofill({ product_id: newId, version: data.doc.version || "" }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const sections = ensureKeys((res.data && res.data.sections) || []);
            dispatch({ loading: false, sections, activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstKey(sections) });
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
        const child = { _key: genKey(), title: "新章节", body: "", tables: [], images: [], children: [] };
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, children: [...(n.children || []), child] })));
        dispatch({ activeKey: child._key });
    };
    const addRoot = () => {
        const node = { _key: genKey(), title: "新章节", body: "", tables: [], images: [], children: [] };
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
        const tables = (active.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const span = isTeamTable(tb) ? undefined : duplicateMerges(tb).anchors[`${r},${ci}`];
            const rs = span?.rs || 1;
            const cs = span?.cs || 1;
            return tb.map((row: any[], ri: number) => (
                ri < r || ri >= r + rs ? row : row.map((cell: any, cc: number) => (cc >= ci && cc < ci + cs ? val : cell))
            ));
        });
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

    // 正文图片：上传/更换/删除（base64 内嵌）
    const uploadImage = (file: File, replaceIndex?: number) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const current = Array.isArray(active.images) ? [...active.images] : [];
            const dataUrl = String(reader.result || "");
            if (replaceIndex !== undefined && replaceIndex >= 0 && replaceIndex < current.length) {
                current[replaceIndex] = dataUrl;
            } else {
                current.push(dataUrl);
            }
            patchNode(data.activeKey, { images: current });
            message.success("图片已更新，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };
    const delImage = (index: number) => {
        const current = Array.isArray(active.images) ? [...active.images] : [];
        current.splice(index, 1);
        patchNode(data.activeKey, { images: current });
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_rmp_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
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
            const res: any = await Api.export_rmp_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const numbers = computeNumbers(data.sections);
    const isAuto = active && (active.ref_type === "scope" || active.ref_type === "activity_plan");

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

    const images: string[] = active && Array.isArray(active.images) ? active.images : [];

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    选择产品
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
                                onChange={(e) => {
                                    const version = e.target.value;
                                    dispatch({
                                        doc: { ...data.doc, version },
                                        sections: syncDocVersionFields(data.sections, version),
                                    });
                                }}
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
                    <Button onClick={() => navigate("/rmp_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；编号按层级自动生成（封面/修订记录不编号）。产品名称/型号/版本/项目时间自动填入「范围」「风险管理活动计划」。风险管理小组表的姓名从风险参与人员自动获取，该表不可改。</div>
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
                                        placeholder="只填名称，如：风险管理定义"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })}
                                    />
                                </div>
                                <div className="pdp-field">
                                    <div className="pdp-label">正文{isAuto ? "（产品信息/项目时间自动获取）" : ""}</div>
                                    <Input.TextArea
                                        autoSize={{ minRows: 3, maxRows: 24 }}
                                        value={showExponent(active.body ?? "")}
                                        disabled={readonly || isAuto}
                                        placeholder="本章节正文内容，可多行"
                                        onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                    />
                                </div>

                                {(active.tables || []).map((tb: any[], ti: number) => {
                                    const isAppendix = active.ref_type === "appendix";
                                    // 整行合并：整行只有第一格有内容
                                    const isFullRow = (row: any[]) => isAppendix && row.length > 1
                                        && String(row?.[0] ?? "").trim() !== ""
                                        && row.slice(1).every((c: any) => String(c ?? "").trim() === "");
                                    const teamLocked = isTeamTable(tb);
                                    const merges = teamLocked ? { anchors: {}, skip: new Set<string>() } : duplicateMerges(tb, (row) => {
                                        if (!isAppendix) return false;
                                        if (isFullRow(row)) return true;
                                        const label = String(row?.[0] ?? "").trim();
                                        return label.startsWith("其他参会人员") || label.startsWith("其他参评人员");
                                    });
                                    return (
                                        <div className="pdp-table-block" key={ti}>
                                            <div className="pdp-table-bar">
                                                <span className="pdp-label">表格 {ti + 1}{teamLocked ? "（风险参与人员自动获取）" : ""}</span>
                                                {!readonly && !teamLocked && (
                                                    <Space size={4}>
                                                        <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                        <Button size="small" disabled={(tb[0] || []).length <= 1} onClick={() => delCol(ti, (tb[0] || []).length - 1)}>－列</Button>
                                                        <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                    </Space>
                                                )}
                                            </div>
                                            <table className="pdp-grid">
                                                <tbody>
                                                    {tb.map((row: any[], r: number) => {
                                                        const cols = row.length;
                                                        const mergeRow = isFullRow(row);
                                                        const otherRow = isAppendix && cols > 2
                                                            && (String(row[0] ?? "").trim().startsWith("其他参会人员")
                                                                || String(row[0] ?? "").trim().startsWith("其他参评人员"));
                                                        const centerRow = mergeRow
                                                            && (String(row[0] ?? "").trim().startsWith("参评人员签字")
                                                                || String(row[0] ?? "").trim().startsWith("评审时间"));
                                                        return (
                                                            <tr key={r}>
                                                                {otherRow ? (
                                                                    <>
                                                                        <td className={r === 0 ? "head" : ""} style={{ textAlign: "center", verticalAlign: "middle" }}>{row[0]}</td>
                                                                        <td colSpan={cols - 1} style={{ textAlign: "center", verticalAlign: "middle" }}>/</td>
                                                                    </>
                                                                ) : mergeRow ? (
                                                                    <td className={r === 0 ? "head" : ""} colSpan={cols}>
                                                                        <Input.TextArea
                                                                            className="pdp-cell"
                                                                            autoSize={{ minRows: 1, maxRows: 8 }}
                                                                            value={row[0] ?? ""}
                                                                            disabled={readonly || teamLocked}
                                                                            style={centerRow ? { textAlign: "center" } : undefined}
                                                                            onChange={(e) => setCell(ti, r, 0, e.target.value)}
                                                                        />
                                                                    </td>
                                                                ) : (
                                                                    row.map((cell: any, ci: number) => {
                                                                        if (merges.skip.has(`${r},${ci}`)) return null;
                                                                        const span = merges.anchors[`${r},${ci}`];
                                                                        return (
                                                                            <td
                                                                                key={ci}
                                                                                className={r === 0 ? "head" : ""}
                                                                                rowSpan={span?.rs}
                                                                                colSpan={span?.cs}
                                                                                style={span ? { verticalAlign: "middle" } : undefined}>
                                                                                {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                    <span style={{ position: "relative", display: "inline-block" }}>
                                                                                        <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                                        {!readonly && !teamLocked && (
                                                                                            <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                                                                                        )}
                                                                                    </span>
                                                                                ) : (
                                                                                    <Input.TextArea
                                                                                        className="pdp-cell"
                                                                                        autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                        value={typeof cell === "string" ? showExponent(cell) : (cell ?? "")}
                                                                                        disabled={readonly || teamLocked}
                                                                                        onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                                    />
                                                                                )}
                                                                            </td>
                                                                        );
                                                                    })
                                                                )}
                                                                {!readonly && !teamLocked && (
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

                                <div className="pdp-field">
                                    <div className="pdp-label">正文图片</div>
                                    {images.map((url: string, imgIndex: number) => (
                                        <div key={imgIndex} style={{ marginBottom: 8 }}>
                                            <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                            {!readonly && (
                                                <Space size={4} style={{ marginTop: 4 }}>
                                                    <Upload
                                                        accept="image/*"
                                                        showUploadList={false}
                                                        beforeUpload={(file) => uploadImage(file as File, imgIndex)}>
                                                        <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                                    </Upload>
                                                    <Button size="small" danger onClick={() => delImage(imgIndex)}>删除</Button>
                                                </Space>
                                            )}
                                        </div>
                                    ))}
                                    {!readonly && (
                                        <Upload
                                            accept="image/*"
                                            showUploadList={false}
                                            beforeUpload={(file) => uploadImage(file as File)}>
                                            <Button size="small" icon={<UploadOutlined />} style={{ margin: "4px 0" }}>上传图片</Button>
                                        </Upload>
                                    )}
                                </div>

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
