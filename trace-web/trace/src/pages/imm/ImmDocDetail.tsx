import { Button, Input, Modal, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { splitBodyTables, reassembleBody } from "@/common/DocBlocks";
import * as Api from "@/api/ApiImmDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewTable from "@/common/ReviewTable";
import "../pdp/PdpDocDetail.less";

let _seq = 0;
const genKey = () => `r${Date.now().toString(36)}_${(_seq++).toString(36)}`;

const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n,
        _key: n._key || genKey(),
        body: n.body ?? "",
        tables: Array.isArray(n.tables) ? n.tables : [],
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

// 编号：封面/修订记录/附录不编号；其余正文顶级 1/2/3，子级 1.1...
// "表N xxx" 这类节点是表格标题块（被上一章节引用），不作为独立章节编号，
// 避免占用章节序号导致后续真实章节号错位。
const NO_NUM = new Set(["cover", "revision", "md5_attachment", "md5_review"]);
const isTableTitle = (title: any): boolean => /^\s*表\d+([、.\s　]|$)/.test(String(title || ""));
const walkChildren = (nodes: any[], prefix: string, map: Record<string, string>) => {
    let idx = 0;
    (nodes || []).forEach((n: any) => {
        if (isTableTitle(n.title)) {
            map[n._key] = "";
            walkChildren(n.children || [], "", map);
            return;
        }
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
        exportingMd5: false,
        exportingReview: false,
        doc: {} as any,
        sections: [] as any[],
        activeKey: "",
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_imm_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const content = doc.content || {};
            const sections = ensureKeys(content.sections || []);
            dispatch({
                loading: false,
                doc,
                sections,
                activeKey: findNode(sections, data.activeKey) ? data.activeKey : firstKey(sections),
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
        const content = {
            sections: stripKeys(data.sections),
        };
        Api.update_imm_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                load();
            } else message.error(res.msg);
        });
    };

    // 切换产品：提示未保存修改会丢失，确认后调 rebind_product 强制用新产品信息重新填充封面/修订记录。
    const rebindProduct = (newId: number) => {
        if (!id || newId === data.doc.product_id) return;
        Modal.confirm({
            title: "切换产品",
            content: "切换产品将重新获取自动填充内容，未保存的修改会丢失，是否继续？",
            okText: "切换",
            cancelText: "取消",
            onOk: () => {
                dispatch({ saving: true });
                Api.rebind_product({ id, product_id: newId }).then((res: any) => {
                    dispatch({ saving: false });
                    if (res.code === Api.C_OK) {
                        message.success(ts("save_success"));
                        const doc = res.data || {};
                        const sections = ensureKeys((doc.content && doc.content.sections) || []);
                        dispatch({ doc, sections, activeKey: firstKey(sections) });
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const doExport = async (kind: "main" | "md5" | "review" = "main") => {
        if (!id) return;
        const key = kind === "md5" ? "exportingMd5" : kind === "review" ? "exportingReview" : "exporting";
        dispatch({ [key]: true });
        try {
            const fn = kind === "md5" ? Api.export_imm_md5_attachment : kind === "review" ? Api.export_imm_md5_review : Api.export_imm_doc;
            const res: any = await fn({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ [key]: false });
        }
    };

    const numbers = computeNumbers(data.sections);
    const isMd5Review = active && active.ref_type === "md5_review";

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
                    安装维护手册
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
                    <Button loading={data.exporting} onClick={() => doExport("main")}>导出安装维护手册</Button>
                    <Button loading={data.exportingMd5} onClick={() => doExport("md5")}>导出MD5值附件</Button>
                    <Button loading={data.exportingReview} onClick={() => doExport("review")}>导出MD5值评审记录</Button>
                    <Button onClick={() => navigate("/imm_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">封面/修订记录/MD5附件与评审不编号；正文 1~5 章自动编号。1.3 运行环境表从「产品管理 → 运行环境」自动获取。</div>
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
                                {(() => {
                                    const images: string[] = Array.isArray(active.images) ? active.images : [];
                                    const segments = splitBodyTables(active.body, active.tables, images);
                                    const hasInterleave = (segments.some((s) => s.type === "table") || segments.some((s) => s.type === "image")) && segments.some((s) => s.type === "text") && !isMd5Review;
                                    if (hasInterleave) {
                                        return segments.map((seg, si) => {
                                            if (seg.type === "text") {
                                                return (
                                                    <div className="pdp-field" key={si}>
                                                        <div className="pdp-label">正文 {si + 1}</div>
                                                        <Input.TextArea
                                                            autoSize={{ minRows: 3, maxRows: 24 }}
                                                            value={seg.text}
                                                            disabled={readonly}
                                                            placeholder="本段正文内容，可多行"
                                                            onChange={(e) => {
                                                                const newBody = reassembleBody(segments, si, e.target.value);
                                                                patchNode(active._key, { body: newBody });
                                                            }}
                                                        />
                                                    </div>
                                                );
                                            }
                                            if (seg.type === "image") {
                                                const ii = seg.imageIndex;
                                                const url = images[ii];
                                                if (!url) return null;
                                                return (
                                                    <div key={si} style={{ margin: "8px 0", textAlign: "center" }}>
                                                        <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                    </div>
                                                );
                                            }
                                            const ti = seg.tableIndex;
                                            const tb = (active.tables || [])[ti];
                                            if (!tb) return null;
                                            const isAppendix = active.ref_type === "appendix";
                                            // 整行合并：整行只有第一格有内容
                                            const isFullRow = (row: any[]) => isAppendix && row.length > 1
                                                && String(row?.[0] ?? "").trim() !== ""
                                                && row.slice(1).every((c: any) => String(c ?? "").trim() === "");
                                            // 第一列连续相同非空项纵向合并（跳过表头与整行合并的行）
                                            const vSpan: Record<number, number> = {};
                                            const vSkip = new Set<number>();
                                            if (isAppendix) {
                                                let r = 1;
                                                while (r < tb.length) {
                                                    const val = String(tb[r]?.[0] ?? "").trim();
                                                    if (isFullRow(tb[r]) || !val) { r++; continue; }
                                                    let j = r + 1;
                                                    while (j < tb.length && !isFullRow(tb[j]) && String(tb[j]?.[0] ?? "").trim() === val) j++;
                                                    if (j - 1 > r) { vSpan[r] = j - r; for (let k = r + 1; k < j; k++) vSkip.add(k); }
                                                    r = j;
                                                }
                                            }
                                            return (
                                                <div className="pdp-table-block" key={si}>
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
                                                                                    disabled={readonly}
                                                                                    style={centerRow ? { textAlign: "center" } : undefined}
                                                                                    onChange={(e) => setCell(ti, r, 0, e.target.value)}
                                                                                />
                                                                            </td>
                                                                        ) : (
                                                                            row.map((cell: any, ci: number) => {
                                                                                if (ci === 0 && vSkip.has(r)) return null;
                                                                                const rowSpan = ci === 0 ? vSpan[r] : undefined;
                                                                                return (
                                                                                    <td key={ci} className={r === 0 ? "head" : ""} rowSpan={rowSpan}>
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
                                                                                );
                                                                            })
                                                                        )}
                                                                        {!readonly && (
                                                                            <td className="pdp-row-op">
                                                                                {tb.length > 1 && (
                                                                                    <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />
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
                                        });
                                    }
                                    return (
                                        <>
                                            <div className="pdp-field">
                                                <div className="pdp-label">正文</div>
                                                <Input.TextArea
                                                    autoSize={{ minRows: 3, maxRows: 24 }}
                                                    value={active.body ?? ""}
                                                    disabled={readonly}
                                                    placeholder="本章节正文内容，可多行"
                                                    onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                                />
                                            </div>
                                            {isMd5Review
                                                ? (active.tables || []).map((tb: any[], ti: number) => (
                                                    <div className="pdp-table-block" key={ti}>
                                                        <div className="pdp-table-bar">
                                                            <span className="pdp-label">{ti === 0 ? "评审内容" : "参评人员签字"}</span>
                                                        </div>
                                                        <ReviewTable grid={tb} />
                                                    </div>
                                                ))
                                                : (active.tables || []).map((tb: any[], ti: number) => {
                                                const isAppendix = active.ref_type === "appendix";
                                                // 整行合并：整行只有第一格有内容
                                                const isFullRow = (row: any[]) => isAppendix && row.length > 1
                                                    && String(row?.[0] ?? "").trim() !== ""
                                                    && row.slice(1).every((c: any) => String(c ?? "").trim() === "");
                                                // 第一列连续相同非空项纵向合并（跳过表头与整行合并的行）
                                                const vSpan: Record<number, number> = {};
                                                const vSkip = new Set<number>();
                                                if (isAppendix) {
                                                    let r = 1;
                                                    while (r < tb.length) {
                                                        const val = String(tb[r]?.[0] ?? "").trim();
                                                        if (isFullRow(tb[r]) || !val) { r++; continue; }
                                                        let j = r + 1;
                                                        while (j < tb.length && !isFullRow(tb[j]) && String(tb[j]?.[0] ?? "").trim() === val) j++;
                                                        if (j - 1 > r) { vSpan[r] = j - r; for (let k = r + 1; k < j; k++) vSkip.add(k); }
                                                        r = j;
                                                    }
                                                }
                                                return (
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
                                                                                        disabled={readonly}
                                                                                        style={centerRow ? { textAlign: "center" } : undefined}
                                                                                        onChange={(e) => setCell(ti, r, 0, e.target.value)}
                                                                                    />
                                                                                </td>
                                                                            ) : (
                                                                                row.map((cell: any, ci: number) => {
                                                                                    if (ci === 0 && vSkip.has(r)) return null;
                                                                                    const rowSpan = ci === 0 ? vSpan[r] : undefined;
                                                                                    return (
                                                                                        <td key={ci} className={r === 0 ? "head" : ""} rowSpan={rowSpan}>
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
                                                                                    );
                                                                                })
                                                                            )}
                                                                            {!readonly && (
                                                                                <td className="pdp-row-op">
                                                                                    {tb.length > 1 && (
                                                                                        <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />
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

                                            {!isMd5Review && (
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
                                            )}

                                            {!readonly && !isMd5Review && (
                                                <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>
                                                    添加表格
                                                </Button>
                                            )}
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
