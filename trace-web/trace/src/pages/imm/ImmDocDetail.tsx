import { Button, Dropdown, Input, Modal, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { splitBodyTables } from "@/common/DocBlocks";
import * as Api from "@/api/ApiImmDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewRecordTables from "@/pages/doc_fill/ReviewRecordTables";
import "../pdp/PdpDocDetail.less";
import { isRuntimeLockedBody, isRuntimeLockedTable } from "../pdp/runtimeEnvLock";
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

const appendBodyLine = (body: string, line: string) => {
    const b = String(body || "");
    if (!b.trim()) return line;
    return b.endsWith("\n") ? `${b}${line}` : `${b}\n${line}`;
};

/** 为图/表补齐 {{IMG}}/{{TBL}} 占位；无占位且同时有图和表时按先图后表，避免默认「表在前」 */
const ensureMediaPlaceholders = (body: string, tables: any[], images: any[]) => {
    let b = String(body || "");
    const nImg = Array.isArray(images) ? images.length : 0;
    const nTbl = Array.isArray(tables) ? tables.length : 0;
    const imgPh = (b.match(/\{\{IMG\}\}/g) || []).length;
    const tblPh = (b.match(/\{\{TBL\}\}/g) || []).length;
    const hasLegacy = /见下图|如下图|下图|见下表|如下表|下表|见表\s*\d/.test(b);
    if (imgPh === 0 && tblPh === 0 && !hasLegacy && nImg > 0 && nTbl > 0) {
        let next = b;
        for (let i = 0; i < nImg; i++) next = appendBodyLine(next, "{{IMG}}");
        for (let i = 0; i < nTbl; i++) next = appendBodyLine(next, "{{TBL}}");
        return next;
    }
    for (let i = imgPh; i < nImg; i++) b = appendBodyLine(b, "{{IMG}}");
    for (let i = tblPh; i < nTbl; i++) b = appendBodyLine(b, "{{TBL}}");
    return b;
};

const removeNthPlaceholder = (body: string, kind: "IMG" | "TBL", index: number) => {
    const token = `{{${kind}}}`;
    let seen = 0;
    return String(body || "")
        .split("\n")
        .filter((ln) => {
            if (ln.trim() !== token) return true;
            if (seen === index) {
                seen += 1;
                return false;
            }
            seen += 1;
            return true;
        })
        .join("\n");
};

/** 图/表前与末尾补空正文槽，清空文字后输入框仍保留 */
const ensureInterleaveTextSlots = (segs: any[]): any[] => {
    if (!segs.length) return [{ type: "text", text: "" }];
    const out: any[] = [];
    for (const seg of segs) {
        if (seg.type === "image" || seg.type === "table") {
            if (!out.length || out[out.length - 1].type !== "text") out.push({ type: "text", text: "" });
            out.push(seg);
        } else if (seg.type === "text") {
            out.push({ ...seg, text: seg.text ?? "" });
        }
    }
    if (out.length && (out[out.length - 1].type === "image" || out[out.length - 1].type === "table")) {
        out.push({ type: "text", text: "" });
    }
    return out;
};

/** {{TXT}} 拆成多段正文，支持连续「添加正文」 */
const expandTxtMarkers = (segs: any[]): any[] => {
    const out: any[] = [];
    for (const seg of segs) {
        if (seg.type !== "text") {
            out.push(seg);
            continue;
        }
        const raw = String(seg.text ?? "");
        if (!raw.includes("{{TXT}}")) {
            out.push(seg);
            continue;
        }
        raw.split(/\{\{TXT\}\}/).forEach((piece) => {
            out.push({ type: "text", text: piece.replace(/^\n+|\n+$/g, "") });
        });
    }
    return out;
};

/** 重组 body：连续正文之间写 {{TXT}}，图/表写静默占位 */
const reassembleImmBody = (segments: any[], editedIndex?: number, newText?: string): string => {
    const next =
        editedIndex === undefined
            ? segments
            : segments.map((seg, i) => (seg.type === "text" && i === editedIndex ? { ...seg, text: newText ?? "" } : seg));
    const parts: string[] = [];
    let prevWasText = false;
    for (const seg of next) {
        if (seg.type === "text") {
            if (prevWasText) parts.push("{{TXT}}");
            parts.push(seg.text ?? "");
            prevWasText = true;
        } else if (seg.type === "table") {
            prevWasText = false;
            parts.push(seg.caption || "{{TBL}}");
        } else if (seg.type === "image") {
            prevWasText = false;
            parts.push(seg.caption || "{{IMG}}");
        }
    }
    return parts.join("\n");
};

const buildImmSegments = (body: string, tables: any[], images: any[]) => {
    const normalized = ensureMediaPlaceholders(body, tables, images);
    return expandTxtMarkers(ensureInterleaveTextSlots(splitBodyTables(normalized, tables, images)));
};

/** 在同级上方/下方插入；返回新树与新节点 key */
const insertSibling = (nodes: any[], key: string, where: "before" | "after"): { sections: any[]; newKey: string } | null => {
    const list = nodes || [];
    const idx = list.findIndex((n: any) => n._key === key);
    if (idx >= 0) {
        const child = blankChapter();
        const next = [...list];
        next.splice(where === "before" ? idx : idx + 1, 0, child);
        return { sections: next, newKey: child._key };
    }
    for (let i = 0; i < list.length; i++) {
        const hit = insertSibling(list[i].children || [], key, where);
        if (!hit) continue;
        const next = [...list];
        next[i] = { ...list[i], children: hit.sections };
        return { sections: next, newKey: hit.newKey };
    }
    return null;
};

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
    const addSiblingAt = (key: string, where: "before" | "after") => {
        const hit = insertSibling(data.sections, key, where);
        if (!hit) return;
        dispatch({ sections: hit.sections, activeKey: hit.newKey });
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
        let segs = buildImmSegments(body, tables, images);
        if (!segs.length) segs = [{ type: "text", text: "" }];
        segs = [...segs, { type: "text", text: "" }];
        patchNode(data.activeKey, { body: reassembleImmBody(segs) });
    };

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
                                <Dropdown
                                    trigger={["click"]}
                                    menu={{
                                        items: [
                                            { key: "before", label: "上方同级", onClick: () => addSiblingAt(n._key, "before") },
                                            { key: "after", label: "下方同级", onClick: () => addSiblingAt(n._key, "after") },
                                            { key: "child", label: "子章节", onClick: () => addChild(n._key) },
                                        ],
                                    }}>
                                    <PlusOutlined title="添加章节" />
                                </Dropdown>
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
                                    const segments = buildImmSegments(String(active.body || ""), active.tables || [], images);
                                    const hasMedia = segments.some((s) => s.type === "table" || s.type === "image");
                                    const textCount = segments.filter((s) => s.type === "text").length;
                                    // 有图/表，或多段正文（含 {{TXT}}）时走交错；清空某段正文仍保留输入框
                                    const hasInterleave = !isMd5Review && (hasMedia || textCount > 1 || /\{\{TXT\}\}/.test(String(active.body || "")));
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
                                                        <div className="pdp-label">正文 {segments.slice(0, si + 1).filter((s: any) => s.type === "text").length}</div>
                                                        <Input.TextArea
                                                            autoSize={{ minRows: 3, maxRows: 24 }}
                                                            value={seg.text}
                                                            disabled={readonly || isRuntimeLockedBody(active)}
                                                            placeholder="本段正文内容，可多行"
                                                            onChange={(e) => {
                                                                patchNode(active._key, { body: reassembleImmBody(segments, si, e.target.value) });
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
                                                        {!readonly && (
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
                                                                                        {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                            <span style={{ position: "relative", display: "inline-block" }}>
                                                                                                <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                                                {!rtLock && (
                                                                                                    <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                                                                                                )}
                                                                                            </span>
                                                                                        ) : (
                                                                                            <Input.TextArea
                                                                                                className="pdp-cell"
                                                                                                autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                                value={cell ?? ""}
                                                                                                disabled={rtLock}
                                                                                                onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                                            />
                                                                                        )}
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
                                        {!readonly && (
                                            <Space wrap style={{ margin: "8px 0" }}>
                                                <Button size="small" onClick={addBodyBlock}>添加正文</Button>
                                                <Upload
                                                    accept="image/*"
                                                    showUploadList={false}
                                                    beforeUpload={(file) => uploadImage(file as File)}>
                                                    <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
                                                </Upload>
                                            </Space>
                                        )}
                                        {!readonly && !isMd5Review && (
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
                                                <div className="pdp-label">正文</div>
                                                <Input.TextArea
                                                    autoSize={{ minRows: 3, maxRows: 24 }}
                                                    value={active.body ?? ""}
                                                    disabled={readonly || isRuntimeLockedBody(active)}
                                                    placeholder="本章节正文内容，可多行"
                                                    onChange={(e) => patchNode(active._key, { body: e.target.value })}
                                                />
                                            </div>
                                            )}
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
                                                                                            {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                                <span style={{ position: "relative", display: "inline-block" }}>
                                                                                                    <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />
                                                                                                    {!rtLock && (
                                                                                                        <DeleteOutlined title="清除签名" style={{ marginLeft: 6, color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />
                                                                                                    )}
                                                                                                </span>
                                                                                            ) : (
                                                                                                <Input.TextArea
                                                                                                    className="pdp-cell"
                                                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                                    value={cell ?? ""}
                                                                                                    disabled={rtLock}
                                                                                                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                                                />
                                                                                            )}
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
                                                {!readonly && (
                                                    <Space wrap style={{ margin: "4px 0" }}>
                                                        <Button size="small" onClick={addBodyBlock}>添加正文</Button>
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
