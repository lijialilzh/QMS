import { Button, Input, Modal, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { useEffect, type ClipboardEvent } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiImmDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewRecordTables from "@/pages/doc_fill/ReviewRecordTables";
import "../pdp/PdpDocDetail.less";
import { isRuntimeLockedTable } from "../pdp/runtimeEnvLock";
import {
    appendBodyLine,
    buildFreeSegments,
    chapterAllowsAboveTable,
    freePlaceAbove,
    ensureMediaPlaceholders,
    reassembleFreeBody,
    removeNthPlaceholder,
    shouldUseFreeInterleave,
} from "../pdp/freeChapterBlocks";
import { FreeSideActions } from "../pdp/FreeChapterContent";
import { syncDocVersionFields } from "@/pages/doc_fill/syncDocVersion";

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

/** 同级交换位置：dir=-1 上移，dir=1 下移；找不到或越界则原样返回 */
const moveSibling = (nodes: any[], key: string, dir: -1 | 1): any[] => {
    const list = nodes || [];
    const idx = list.findIndex((n: any) => n._key === key);
    if (idx >= 0) {
        const j = idx + dir;
        if (j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[idx], next[j]] = [next[j], next[idx]];
        return next;
    }
    return list.map((n: any) => ({ ...n, children: moveSibling(n.children || [], key, dir) }));
};

const blankChapter = () => ({ _key: genKey(), title: "新章节", body: "", tables: [], images: [], children: [] as any[] });

const firstKey = (nodes: any[]): string => (nodes && nodes[0] ? nodes[0]._key : "");

const stripNum = (title: string): string => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

/** 自动获取正文（总体描述/适用范围/联系信息/确认产品信息）：编辑页只读 */
const isImmAutofillLockedBody = (node: any): boolean => {
    const plain = stripNum(node?.title || "");
    return (
        plain === "软件总体描述" ||
        plain === "适用范围" ||
        plain === "联系信息" ||
        plain === "确认产品信息"
    );
};

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
                sections: syncDocVersionFields(sections, doc.version),
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
        const child = blankChapter();
        setSections(mapNode(data.sections, key, (n: any) => ({ ...n, children: [...(n.children || []), child] })));
        dispatch({ activeKey: child._key });
    };
    const addRoot = () => {
        const node = blankChapter();
        const sections = [...data.sections];
        const reviewAt = sections.findIndex((n: any) => n.ref_type === "review" || String(n.title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").includes("评审记录"));
        if (reviewAt >= 0) sections.splice(reviewAt, 0, node);
        else sections.push(node);
        dispatch({ sections, activeKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.sections, key);
        dispatch({ sections, activeKey: data.activeKey === key ? firstKey(sections) : data.activeKey });
    };
    const moveNode = (key: string, dir: -1 | 1) => {
        setSections(moveSibling(data.sections, key, dir));
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
    const addTable = () => {
        if (!active) return;
        const tables = [...(active.tables || []), [["", ""], ["", ""]]];
        const images = Array.isArray(active.images) ? active.images : [];
        // 先补已有图片占位，再追加本表，保证「先图后表」顺序
        let body = ensureMediaPlaceholders(String(active.body || ""), active.tables || [], images);
        body = appendBodyLine(body, "{{TBL}}");
        patchNode(data.activeKey, { tables, body });
    };
    const delTable = (ti: number) => {
        if (!active) return;
        const tables = (active.tables || []).filter((_: any, i: number) => i !== ti);
        const body = removeNthPlaceholder(String(active.body || ""), "TBL", ti);
        patchNode(data.activeKey, { tables, body });
    };

    const addBodyBlock = () => {
        if (!active) return;
        const images = Array.isArray(active.images) ? active.images : [];
        const tables = active.tables || [];
        const body = ensureMediaPlaceholders(String(active.body || ""), tables, images);
        let segs = buildFreeSegments(body, tables, images);
        if (!segs.length) segs = [{ type: "text", text: "" }];
        segs = [...segs, { type: "text", text: "" }];
        patchNode(data.activeKey, { body: reassembleFreeBody(segs) });
    };
    const placeAbove = (kind: "body" | "image" | "table", dataUrl?: string) => {
        if (!active) return;
        const st = {
            body: String(active.body || ""),
            tables: active.tables || [],
            images: Array.isArray(active.images) ? active.images : [],
        };
        const next = freePlaceAbove(st, kind, dataUrl);
        patchNode(data.activeKey, { tables: next.tables, body: next.body, images: next.images });
        if (kind === "image") message.success("图片已更新，请保存文档");
    };
    const aboveBar = active && !readonly && !isImmAutofillLockedBody(active) && chapterAllowsAboveTable(active) && (active.tables || []).length > 0 ? (
        <FreeSideActions
            label="上方添加正文"
            onBody={() => placeAbove("body")}
            onImageData={(url) => placeAbove("image", url)}
            onTable={() => placeAbove("table")}
        />
    ) : null;

    // 正文图片：上传/更换/删除（base64 内嵌）；新增图在 body 末尾追加 {{IMG}} 以保持插入顺序
    const uploadImage = (file: File, replaceIndex?: number) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (!active) return;
            const current = Array.isArray(active.images) ? [...active.images] : [];
            const dataUrl = String(reader.result || "");
            if (replaceIndex !== undefined && replaceIndex >= 0 && replaceIndex < current.length) {
                current[replaceIndex] = dataUrl;
                patchNode(data.activeKey, { images: current });
            } else {
                current.push(dataUrl);
                let body = ensureMediaPlaceholders(String(active.body || ""), active.tables || [], current.slice(0, -1));
                body = appendBodyLine(body, "{{IMG}}");
                patchNode(data.activeKey, { images: current, body });
            }
            message.success("图片已更新，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };
    const delImage = (index: number) => {
        if (!active) return;
        const current = Array.isArray(active.images) ? [...active.images] : [];
        current.splice(index, 1);
        const body = removeNthPlaceholder(String(active.body || ""), "IMG", index);
        patchNode(data.activeKey, { images: current, body });
    };

    /** 表内单元格：上传/粘贴图片为 data:image（截图列等） */
    const putCellImage = (ti: number, r: number, ci: number, file: File) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setCell(ti, r, ci, String(reader.result || ""));
            message.success("图片已写入单元格，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };
    const onCellPasteImage = (e: ClipboardEvent, ti: number, r: number, ci: number, locked: boolean) => {
        if (locked) return;
        const items = Array.from(e.clipboardData?.items || []);
        const imgItem = items.find((it) => it.type.startsWith("image/"));
        if (!imgItem) return;
        const file = imgItem.getAsFile();
        if (!file) return;
        e.preventDefault();
        putCellImage(ti, r, ci, file);
    };
    /** 仅「截图」列表头对应列允许上传/粘贴图片 */
    const isScreenshotCol = (tb: any[], ci: number) => {
        const h = String((tb?.[0] || [])[ci] ?? "").replace(/\s+/g, "");
        return h === "截图";
    };
    const renderCellBody = (ti: number, r: number, ci: number, cell: any, locked: boolean, tb: any[]) => {
        const allowImg = r > 0 && isScreenshotCol(tb, ci);
        const isImg = typeof cell === "string" && cell.startsWith("data:image");
        if (isImg) {
            return (
                <div style={{ textAlign: "center" }}>
                    <img
                        src={cell}
                        alt=""
                        style={{ maxWidth: "100%", maxHeight: 220, width: "auto", objectFit: "contain", display: "block", margin: "0 auto" }}
                    />
                    {!locked && allowImg && (
                        <Space size={4} style={{ marginTop: 4, justifyContent: "center" }}>
                            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => putCellImage(ti, r, ci, file as File)}>
                                <Button size="small" icon={<UploadOutlined />}>更换</Button>
                            </Upload>
                            <Button size="small" danger onClick={() => setCell(ti, r, ci, "")}>清除</Button>
                        </Space>
                    )}
                    {!locked && !allowImg && (
                        <DeleteOutlined title="清除" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                    )}
                </div>
            );
        }
        return (
            <div>
                <Input.TextArea
                    className="pdp-cell"
                    autoSize={{ minRows: 1, maxRows: 8 }}
                    value={cell ?? ""}
                    disabled={locked}
                    placeholder={allowImg && !locked ? "可上传或粘贴截图" : undefined}
                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                    onPaste={(e) => (allowImg ? onCellPasteImage(e, ti, r, ci, locked) : undefined)}
                />
                {allowImg && !locked && (
                    <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => putCellImage(ti, r, ci, file as File)}>
                        <Button size="small" type="link" icon={<UploadOutlined />} style={{ padding: "0 4px" }}>
                            上传图片
                        </Button>
                    </Upload>
                )}
            </div>
        );
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
        (nodes || []).map((n: any, i: number) => {
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
                                <span className="pdp-nav-move">
                                    {i > 0 && <ArrowUpOutlined title="上移" onClick={() => moveNode(n._key, -1)} />}
                                    {i < (nodes || []).length - 1 && <ArrowDownOutlined title="下移" onClick={() => moveNode(n._key, 1)} />}
                                </span>
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
                                    const isTopoAuto = stripNum(active.title) === "硬件拓扑";
                                    const autofillBodyLock = isImmAutofillLockedBody(active);
                                    const bodyLock = readonly || autofillBodyLock;
                                    const bodyBoxStyle = { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const };
                                    const segments = buildFreeSegments(String(active.body || ""), active.tables || [], images);
                                    // 有图/表，或多段正文（含 {{TXT}}）时走交错；清空某段正文仍保留输入框
                                    const hasInterleave = shouldUseFreeInterleave(String(active.body || ""), segments, { skip: isMd5Review });
                                    const hideBodyBox = isTopoAuto;
                                    // 硬件拓扑：自动取图只读，暂无正文
                                    if (isTopoAuto) {
                                        return (
                                            <div className="pdp-field">
                                                <div className="pdp-label">物理拓扑图（自动获取，只读）</div>
                                                {images.length ? images.map((url: string, imgIndex: number) => (
                                                    <div key={imgIndex} style={{ marginBottom: 8, textAlign: "center" }}>
                                                        <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                    </div>
                                                )) : (
                                                    <div className="pdp-empty" style={{ padding: 12 }}>该产品暂无物理拓扑图，请先在「产品图示 → 物理拓扑图」上传</div>
                                                )}
                                            </div>
                                        );
                                    }
                                    if (hasInterleave) {
                                        return (
                                        <>
                                        {segments.map((seg, si) => {
                                            if (seg.type === "text") {
                                                return (
                                                    <div className="pdp-field" key={si}>
                                                        <div className="pdp-label">正文 {segments.slice(0, si + 1).filter((s: any) => s.type === "text").length}{autofillBodyLock ? "（自动获取，只读）" : ""}</div>
                                                        <Input.TextArea
                                                            autoSize={{ minRows: 3, maxRows: 24 }}
                                                            value={seg.text}
                                                            disabled={bodyLock}
                                                            style={bodyBoxStyle}
                                                            placeholder="本段正文内容，可多行"
                                                            onChange={(e) => {
                                                                patchNode(active._key, { body: reassembleFreeBody(segments, si, e.target.value) });
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
                                                        {!readonly && !autofillBodyLock && (
                                                            <Space size={4} style={{ marginTop: 4, display: "flex", justifyContent: "center" }}>
                                                                <Upload
                                                                    accept="image/*"
                                                                    showUploadList={false}
                                                                    beforeUpload={(file) => uploadImage(file as File, ii)}>
                                                                    <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                                                </Upload>
                                                                <Button size="small" danger onClick={() => delImage(ii)}>删除</Button>
                                                            </Space>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            const ti = seg.tableIndex;
                                            const tb = (active.tables || [])[ti];
                                            if (!tb) return null;
                                            const isAppendix = active.ref_type === "appendix";
                                            const rtLock = readonly || isRuntimeLockedTable(active, ti);
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
                                                    {si === segments.findIndex((s: any) => s.type === "table") ? aboveBar : null}
                                                    <div className="pdp-table-bar">
                                                        <span className="pdp-label">表格 {ti + 1}{rtLock ? "（运行环境自动获取，只读）" : ""}</span>
                                                        {!rtLock && (
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
                                                                                    disabled={rtLock}
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
                                                                                        {renderCellBody(ti, r, ci, cell, rtLock, tb)}
                                                                                    </td>
                                                                                );
                                                                            })
                                                                        )}
                                                                        {!rtLock && (
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
                                        {!readonly && !autofillBodyLock && (
                                            <Space wrap style={{ margin: "8px 0" }}>
                                                <Button size="small" onClick={addBodyBlock}>{(active.tables || []).length ? "下方添加正文" : "添加正文"}</Button>
                                                <Upload
                                                    accept="image/*"
                                                    showUploadList={false}
                                                    beforeUpload={(file) => uploadImage(file as File)}>
                                                    <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
                                                </Upload>
                                            </Space>
                                        )}
                                        {!readonly && !autofillBodyLock && !isMd5Review && (
                                            <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>
                                                添加表格
                                            </Button>
                                        )}
                                        </>
                                        );
                                    }
                                    return (
                                        <>
                                            {!hideBodyBox && (
                                            <div className="pdp-field">
                                                <div className="pdp-label">正文{autofillBodyLock ? "（自动获取，只读）" : ""}</div>
                                                <Input.TextArea
                                                    autoSize={{ minRows: 3, maxRows: 24 }}
                                                    value={active.body ?? ""}
                                                    disabled={bodyLock}
                                                    style={bodyBoxStyle}
                                                    placeholder="本章节正文内容，可多行"
                                                    onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                                />
                                            </div>
                                            )}
                                            {aboveBar}
                                            {isMd5Review
                                                ? (
                                                    <ReviewRecordTables tables={active.tables || []} readonly={readonly} onChange={updateTables} />
                                                )
                                                : (active.tables || []).map((tb: any[], ti: number) => {
                                                const isAppendix = active.ref_type === "appendix";
                                                const rtLock = readonly || isRuntimeLockedTable(active, ti);
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
                                                            <span className="pdp-label">表格 {ti + 1}{rtLock ? "（运行环境自动获取，只读）" : ""}</span>
                                                            {!rtLock && (
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
                                                                                        disabled={rtLock}
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
                                                                                            {renderCellBody(ti, r, ci, cell, rtLock, tb)}
                                                                                        </td>
                                                                                    );
                                                                                })
                                                                            )}
                                                                            {!rtLock && (
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
                                                {!readonly && !autofillBodyLock && (
                                                    <Space wrap style={{ margin: "4px 0" }}>
                                                        <Button size="small" onClick={addBodyBlock}>{(active.tables || []).length ? "下方添加正文" : "添加正文"}</Button>
                                                        <Upload
                                                            accept="image/*"
                                                            showUploadList={false}
                                                            beforeUpload={(file) => uploadImage(file as File)}>
                                                            <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
                                                        </Upload>
                                                    </Space>
                                                )}
                                            </div>
                                            )}

                                            {!readonly && !autofillBodyLock && !isMd5Review && (
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
