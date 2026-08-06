import { Button, Form, Input, Select, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiCybersecPlanDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiDocFile from "@/api/ApiDocFile";
import "../pdp/PdpDocDetail.less";

const emptyContent = { sections: [], productName: "" };

const DOC_TITLE = "网络安全风险管理计划";

const createCoverSection = () => ({
    title: DOC_TITLE, ref_type: "cover", children: [],
    tables: [[["编制部门", "", "文件版本", ""], ["编制人", "", "日期", ""], ["审核人", "", "日期", ""], ["批准人", "", "日期", ""], ["生效日期", "", "", ""]]],
});
const createRevisionSection = () => ({
    title: "文件修订记录", ref_type: "revision", children: [],
    tables: [[["修改日期", "版本号", "修订说明", "修订人", "批准人"], ["", "", "首次发布", "", ""], ["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]]],
});

const normalizeTitleText = (value: any) => String(value || "").replace(/\s+/g, "");
const isCoverSection = (s: any) => s?.ref_type === "cover" || normalizeTitleText(s?.title) === DOC_TITLE;
const isRevisionSection = (s: any) => s?.ref_type === "revision" || normalizeTitleText(s?.title) === "文件修订记录";
const isFlowDiagramSection = (s: any) => s?.ref_type === "flow_diagram" || normalizeTitleText(s?.title).endsWith("系统总体架构");
const isImgTopoSection = (s: any) => s?.ref_type === "img_topo" || normalizeTitleText(s?.title).includes("物理拓扑图");
const isImgStructSection = (s: any) => s?.ref_type === "img_struct" || normalizeTitleText(s?.title).includes("系统架构");

// 正文图题关键词 -> 图表文件管理分类（参考产品技术要求）
const CAPTION_CATS: [string, string][] = [
    ["物理拓扑图", "img_topo"],
    ["体系结构图", "img_struct"],
];
// 扫描正文中的图题行，返回 [{caption, category}]
const getImageAnchors = (node: any): { caption: string; category: string; lineIndex: number }[] => {
    const anchors: { caption: string; category: string; lineIndex: number }[] = [];
    const lines = String(node?.text || "").split("\n");
    lines.forEach((ln, idx) => {
        const s = ln.trim();
        if (/^图\s*\d/.test(s)) {
            const hit = CAPTION_CATS.find(([kw]) => s.includes(kw));
            if (hit && !anchors.some((a) => a.category === hit[1])) {
                anchors.push({ caption: s, category: hit[1], lineIndex: idx });
            }
        }
    });
    return anchors;
};
// 按锚点把正文拆成 N+1 段
const splitTextByAnchors = (text: string, anchors: { lineIndex: number }[]): string[] => {
    const lines = String(text || "").split("\n");
    const idxs = anchors.map((a) => a.lineIndex).sort((a, b) => a - b);
    const parts: string[] = [];
    let start = 0;
    idxs.forEach((ai) => { parts.push(lines.slice(start, ai + 1).join("\n")); start = ai + 1; });
    parts.push(lines.slice(start).join("\n"));
    return parts;
};

const stripSectionNo = (title: any) => String(title || "").replace(/^[0-9０-９.．\s、]+/, "").trim();

const makeRowKey = () => `${Date.now()}-${Math.random()}`;
const ensureKeys = (nodes: any[]): any[] =>
    (nodes || []).map((n: any) => ({
        ...n, _key: n._key || makeRowKey(),
        text: n.text ?? n.body ?? "",
        tables: Array.isArray(n.tables) ? n.tables : [],
        blocks: Array.isArray(n.blocks) ? n.blocks : undefined,
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
    (nodes || []).map((n: any) => n._key === key ? fn(n) : { ...n, children: mapNode(n.children || [], key, fn) });
const removeNode = (nodes: any[], key: string): any[] =>
    (nodes || []).filter((n: any) => n._key !== key).map((n: any) => ({ ...n, children: removeNode(n.children || [], key) }));
const firstKey = (nodes: any[]): string => (nodes && nodes[0] ? nodes[0]._key : "");
const sectionKey = (s: any) => s?._key || s?.title || s?.ref_type || "";

const NO_NUM = new Set(["cover", "revision", "appendix"]);
const walkChildren = (nodes: any[], prefix: string, map: Record<string, string>) => {
    let idx = 0;
    (nodes || []).forEach((n: any) => { idx += 1; const num = prefix ? `${prefix}.${idx}` : `${idx}`; map[n._key] = num; walkChildren(n.children || [], num, map); });
};
const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (NO_NUM.has(n.ref_type)) { map[n._key] = ""; walkChildren(n.children || [], "", map); return; }
        bodyIdx += 1; map[n._key] = String(bodyIdx); walkChildren(n.children || [], String(bodyIdx), map);
    });
    return map;
};

const ensureFrontMatterSections = (content: any) => {
    const next = JSON.parse(JSON.stringify({ ...emptyContent, ...(content || {}) }));
    const sections = Array.isArray(next.sections) ? next.sections : [];
    const cover = sections.find(isCoverSection) || createCoverSection();
    const revision = sections.find(isRevisionSection) || createRevisionSection();
    const body = sections.filter((s: any) => !isCoverSection(s) && !isRevisionSection(s));
    next.sections = [cover, revision, ...body];
    return next;
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isAdd = location.pathname.includes("/add");
    const isView = location.pathname.includes("/view/");
    const [form] = Form.useForm();
    const [data, dispatch] = useData({
        loading: false, saving: false, exporting: false,
        detail: {} as any, content: emptyContent, products: [] as any[],
        activeSectionKey: "", selectedProductId: undefined as any,
        docImages: {} as Record<string, string>,
    });

    const loadProducts = () => {
        if ((data.products || []).length > 0) return;
        ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    // 加载图表文件（参考产品技术要求，用docImages字典）
    const loadDocImages = (productId: any) => {
        if (!productId) { dispatch({ docImages: {} }); return; }
        const cats = ["img_topo", "img_struct"];
        Promise.all(cats.map((cat) =>
            ApiDocFile.list_doc_file(cat, { product_id: productId, page_index: 0, page_size: 50 })
                .then((res: any) => {
                    const first = res.code === ApiDocFile.C_OK ? (res.data?.rows || [])[0] : null;
                    return [cat, first?.file_url ? `/${first.file_url}` : ""] as [string, string];
                })
                .catch(() => [cat, ""] as [string, string])
        )).then((pairs) => {
            const images: Record<string, string> = {};
            pairs.forEach(([cat, url]) => { if (url) images[cat] = url; });
            dispatch({ docImages: images });
        });
    };

    // 切换产品：调用 autofill 获取自动填充后的内容
    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, selectedProductId: newId, detail: { ...data.detail, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        Api.cybersec_plan_autofill({ product_id: newId, version: data.detail.version || "" }).then((res: any) => {
            if (res.code !== Api.C_OK) { dispatch({ loading: false }); message.error(res.msg); return; }
            const content = ensureFrontMatterSections(res.data || emptyContent);
            const sections = ensureKeys(content.sections || []);
            const fallback = sections.find((s: any) => !isCoverSection(s) && !isRevisionSection(s));
            dispatch({ loading: false, content: { ...content, sections }, activeSectionKey: sectionKey(fallback) });
            loadDocImages(newId);
        });
    };

    const load = () => {
        if (isAdd) {
            loadProducts();
            // 新增模式：加载默认模板（后端 autofill 会自动填充产品信息，但新增时还没选产品）
            dispatch({ loading: true });
            Api.cybersec_plan_autofill({ product_id: 0, version: "" }).then((res: any) => {
                if (res.code !== Api.C_OK) { dispatch({ loading: false }); return; }
                const content = ensureFrontMatterSections(res.data || emptyContent);
                const sections = ensureKeys(content.sections || []);
                const fallback = sections.find((s: any) => !isCoverSection(s) && !isRevisionSection(s));
                dispatch({ loading: false, content: { ...content, sections }, activeSectionKey: sectionKey(fallback) });
            });
            return;
        }
        if (!params.id) return;
        dispatch({ loading: true });
        Api.get_cybersec_plan_doc({ id: params.id }).then((res: any) => {
            if (res.code !== Api.C_OK) { dispatch({ loading: false }); message.error(res.msg); return; }
            const detail = res.data || {};
            let content = ensureFrontMatterSections(detail.content || emptyContent);
            const sections = ensureKeys(content.sections || []);
            const fallback = sections.find((s: any) => !isCoverSection(s) && !isRevisionSection(s));
            dispatch({ loading: false, detail, content: { ...content, sections }, activeSectionKey: sectionKey(fallback), selectedProductId: detail.product_id });
            loadDocImages(detail.product_id);
        });
    };

    useEffect(() => { loadProducts(); load(); }, [params.id, location.pathname]);

    const setSections = (sections: any[]) => dispatch({ content: { ...data.content, sections } });
    const patchNode = (key: string, patch: any) =>
        setSections(mapNode(data.content.sections, key, (n: any) => ({ ...n, ...patch })));

    const addChild = (key: string) => {
        const child = { _key: makeRowKey(), title: "新章节", text: "", tables: [], children: [] };
        setSections(mapNode(data.content.sections, key, (n: any) => ({ ...n, children: [...(n.children || []), child] })));
        dispatch({ activeSectionKey: child._key });
    };
    const addRoot = () => {
        const node = { _key: makeRowKey(), title: "新章节", text: "", tables: [], children: [] };
        const sections = [...data.content.sections, node];
        setSections(sections); dispatch({ activeSectionKey: node._key });
    };
    const delNode = (key: string) => {
        const sections = removeNode(data.content.sections, key);
        setSections(sections); dispatch({ activeSectionKey: data.activeSectionKey === key ? sectionKey(sections.find((s: any) => !isCoverSection(s) && !isRevisionSection(s))) : data.activeSectionKey });
    };

    const active = findNode(data.content.sections, data.activeSectionKey);
    const updateTables = (tables: any[]) => patchNode(data.activeSectionKey, { tables });
    const setCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = (active?.tables || []).map((tb: any[], i: number) =>
            i !== ti ? tb : tb.map((row: any[], ri: number) => ri !== r ? row : row.map((c: any, ci2: number) => ci2 === ci ? val : c))
        );
        updateTables(tables);
    };
    const addRow = (ti: number) => {
        const tables = (active?.tables || []).map((tb: any[], i: number) => {
            if (i !== ti) return tb;
            const cols = tb[0] ? tb[0].length : 1; return [...tb, new Array(cols).fill("")];
        });
        updateTables(tables);
    };
    const delRow = (ti: number, r: number) => {
        const tables = (active?.tables || []).map((tb: any[], i: number) => i !== ti ? tb : tb.filter((_: any, ri: number) => ri !== r));
        updateTables(tables);
    };
    const addCol = (ti: number) => {
        const tables = (active?.tables || []).map((tb: any[], i: number) => i !== ti ? tb : tb.map((row: any[]) => [...row, ""]));
        updateTables(tables);
    };
    const delCol = (ti: number, ci: number) => {
        const tables = (active?.tables || []).map((tb: any[], i: number) => i !== ti ? tb : tb.map((row: any[]) => row.filter((_: any, cc: number) => cc !== ci)));
        updateTables(tables);
    };
    const addTable = () => updateTables([...(active?.tables || []), [["", ""], ["", ""]]]);
    const delTable = (ti: number) => updateTables((active?.tables || []).filter((_: any, i: number) => i !== ti));

    // blocks 支持：正文与表格交错展示
    const updateBlocks = (blocks: any[]) => patchNode(data.activeSectionKey, { blocks });
    const setBlockText = (bi: number, val: string) => {
        const blocks = (active?.blocks || []).map((b: any, i: number) => i !== bi ? b : { ...b, text: val });
        updateBlocks(blocks);
    };
    const setBlockCell = (bi: number, r: number, ci: number, val: string) => {
        const blocks = (active?.blocks || []).map((b: any, i: number) => {
            if (i !== bi || b.type !== "table") return b;
            const table = (b.table || []).map((row: any[], ri: number) => ri !== r ? row : row.map((c: any, ci2: number) => ci2 === ci ? val : c));
            return { ...b, table };
        });
        updateBlocks(blocks);
    };
    const addBlockRow = (bi: number) => {
        const blocks = (active?.blocks || []).map((b: any, i: number) => {
            if (i !== bi || b.type !== "table") return b;
            const cols = b.table?.[0]?.length || 1;
            return { ...b, table: [...(b.table || []), new Array(cols).fill("")] };
        });
        updateBlocks(blocks);
    };
    const delBlockRow = (bi: number, r: number) => {
        const blocks = (active?.blocks || []).map((b: any, i: number) => {
            if (i !== bi || b.type !== "table") return b;
            return { ...b, table: (b.table || []).filter((_: any, ri: number) => ri !== r) };
        });
        updateBlocks(blocks);
    };
    const addBlockTable = () => updateBlocks([...(active?.blocks || []), { type: "table", table: [["", ""], ["", ""]] }]);
    const addBlockText = () => updateBlocks([...(active?.blocks || []), { type: "text", text: "" }]);
    const delBlock = (bi: number) => updateBlocks((active?.blocks || []).filter((_: any, i: number) => i !== bi));

    const doSave = () => {
        if (!params.id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.content.sections), productName: data.content.productName || "" };
        Api.update_cybersec_plan_doc({ id: params.id, content, product_id: data.detail.product_id, version: data.detail.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) { message.success(ts("save_success")); load(); }
            else message.error(res.msg);
        });
    };

    const doExport = async () => {
        if (!params.id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_cybersec_plan_doc({ id: params.id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) { message.error("导出失败"); }
        finally { dispatch({ exporting: false }); }
    };

    const numbers = computeNumbers(data.content.sections);

    const renderNav = (nodes: any[], depth: number) =>
        (nodes || []).map((n: any) => {
            const num = numbers[n._key];
            const label = `${num ? num + " " : ""}${stripSectionNo(n.title) || "(未命名)"}`;
            return (
                <div key={n._key}>
                    <div className={`pdp-nav-item${n._key === data.activeSectionKey ? " active" : ""}`}
                        style={{ paddingLeft: 8 + depth * 14 }}
                        onClick={() => dispatch({ activeSectionKey: n._key })}>
                        <span className="pdp-nav-title" title={label}>{label}</span>
                        {!isView && (
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

    // 图片自动获取章节（img_topo/img_struct）
    const autoImgCat = isImgTopoSection(active) ? "img_topo" : isImgStructSection(active) ? "img_struct" : "";
    const autoImageUrl = autoImgCat ? (data.docImages?.[autoImgCat] || "") : "";
    const isAutoImgSection = isImgTopoSection(active) || isImgStructSection(active);

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    {DOC_TITLE}
                    {isView ? (
                        <span className="pdp-meta">
                            {data.detail.product_name ? `　${data.detail.product_name}` : ""}
                            {data.detail.product_full_version ? ` / ${data.detail.product_full_version}` : ""}
                            {data.detail.version ? `　文档版本：${data.detail.version}` : ""}
                        </span>
                    ) : (
                        <span className="pdp-meta" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                            <span style={{ width: 340, display: "inline-block" }}>
                                <ProductVersionSelect
                                    products={data.products}
                                    value={data.detail.product_id || data.selectedProductId}
                                    allowClear={false}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(v) => v && rebindProduct(v)}
                                />
                            </span>
                            <span style={{ whiteSpace: "nowrap" }}>文档版本：</span>
                            <Input size="small" style={{ width: 110 }} value={data.detail.version || ""}
                                onChange={(e) => dispatch({ detail: { ...data.detail, version: e.target.value } })} />
                        </span>
                    )}
                </div>
                <Space>
                    {!isView && <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/cybersec_plan_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!isView && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；编号自动生成（封面/修订记录不编号）。产品信息/拓扑图/架构图自动获取。</div>
                        )}
                        {renderNav(data.content.sections, 0)}
                        {!isView && (
                            <Button className="pdp-nav-add" type="dashed" size="small" icon={<PlusOutlined />} onClick={addRoot}>顶级章节</Button>
                        )}
                    </div>

                    <div className="pdp-editor">
                        {!active ? (
                            <div className="pdp-empty">请选择或新增左侧章节</div>
                        ) : (
                            <>
                                <div className="pdp-field">
                                    <div className="pdp-label">章节标题{numbers[active._key] ? `（编号 ${numbers[active._key]} 自动生成）` : ""}</div>
                                    <Input addonBefore={numbers[active._key] || undefined}
                                        value={stripSectionNo(active.title)} disabled={isView}
                                        placeholder="只填名称"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })} />
                                </div>

                                {/* 图片自动获取章节：按锚点拆分正文，图题行后插入图片（参考产品技术要求） */}
                                {isAutoImgSection ? (
                                    (() => {
                                        const anchors = getImageAnchors(active);
                                        if (anchors.length === 0) {
                                            // 无锚点：正文+图片
                                            return (
                                                <>
                                                    <div className="pdp-field">
                                                        <div className="pdp-label">正文</div>
                                                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 24 }}
                                                            value={active.text ?? ""} disabled={isView}
                                                            onChange={(e) => patchNode(active._key, { text: e.target.value })} />
                                                    </div>
                                                    <div className="pdp-field">
                                                        <div className="pdp-label">{isImgTopoSection(active) ? "物理拓扑图（自动获取）" : "系统架构（自动获取）"}</div>
                                                        {autoImageUrl ? (
                                                            <img src={autoImageUrl} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                                        ) : (
                                                            <div style={{ color: "#999", padding: 16 }}>无图，请先在「产品管理 → 产品图示」上传对应图片。</div>
                                                        )}
                                                    </div>
                                                </>
                                            );
                                        }
                                        const parts = splitTextByAnchors(active.text, anchors);
                                        const setSegment = (i: number, val: string) => {
                                            const newParts = [...parts];
                                            newParts[i] = val;
                                            patchNode(active._key, { text: newParts.join("\n") });
                                        };
                                        const segLabel = (i: number) =>
                                            parts.length === 1 ? "正文" : i === 0 ? "正文（图前）" : i === parts.length - 1 ? "正文（图后）" : "正文（图间）";
                                        return parts.map((p, i) => (
                                            <div key={`seg-${i}`}>
                                                <div className="pdp-field">
                                                    <div className="pdp-label">{segLabel(i)}</div>
                                                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 20 }}
                                                        value={p} disabled={isView}
                                                        placeholder={i === 0 ? "图片前的正文内容" : "图片后的正文内容"}
                                                        onChange={(e) => setSegment(i, e.target.value)} />
                                                </div>
                                                {i < anchors.length && (
                                                    <div className="pdp-field">
                                                        <div className="pdp-label">{anchors[i].caption}（取自「图表文件管理」，自动获取）</div>
                                                        {data.docImages?.[anchors[i].category] ? (
                                                            <img src={data.docImages[anchors[i].category]} alt="" style={{ maxWidth: "100%", border: "1px solid #eee", borderRadius: 4 }} />
                                                        ) : (
                                                            <div style={{ color: "#999", padding: "8px 0" }}>
                                                                未在「图表文件管理 - {anchors[i].caption}」找到该产品的图片。
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ));
                                    })()
                                ) : Array.isArray(active.blocks) && active.blocks.length > 0 ? (
                                    <>
                                        {/* blocks 模式：正文与表格交错展示 */}
                                        {(active.blocks || []).map((block: any, bi: number) => {
                                            if (block?.type === "table") {
                                                const tb = Array.isArray(block.table) ? block.table : [];
                                                // 仅风险矩阵表（含红色/黄色/绿色行）做标签合并与分数着色
                                                const isMatrixTable = tb.some((row: any[]) => {
                                                    const v = String(row?.[0] ?? "").trim();
                                                    return v === "红色" || v === "黄色" || v === "绿色";
                                                });
                                                return (
                                                    <div className="pdp-table-block" key={`blk-${bi}`}>
                                                        <div className="pdp-table-bar">
                                                            <span className="pdp-label">表格 {bi + 1}</span>
                                                            {!isView && (
                                                                <Space size={4}>
                                                                    <Button size="small" onClick={() => addBlockRow(bi)}>＋行</Button>
                                                                    <Button size="small" danger onClick={() => delBlock(bi)}>删除此表</Button>
                                                                </Space>
                                                            )}
                                                        </div>
                                                        <table className="pdp-grid" style={{ tableLayout: "fixed", width: "100%" }}>
                                                            {(() => {
                                                                const maxCols = Math.max(...tb.map((row: any[]) => (row || []).length));
                                                                if (maxCols <= 1) return null;
                                                                let widths: string[];
                                                                if (maxCols === 2) widths = ["20%", "80%"];
                                                                else if (maxCols === 3) widths = ["10%", "55%", "35%"];
                                                                else if (maxCols === 4) widths = ["12%", "18%", "35%", "35%"];
                                                                else widths = new Array(maxCols).fill(`${100/maxCols}%`);
                                                                return <colgroup>{widths.map((w, i) => <col key={`bc${i}`} style={{ width: w }} />)}</colgroup>;
                                                            })()}
                                                            <tbody>
                                                                {tb.map((row: any[], r: number) => {
                                                                    const maxCols = Math.max(...tb.map((rr: any[]) => (rr || []).length));
                                                                    const mergeRow = row.length === 1 && String(row[0] ?? "").trim() !== "";
                                                                    const isHeaderRow = !mergeRow && (r === 0 || (r === 1 && tb[0].length === 1));
                                                                    // 仅红色/黄色/绿色行：第1列标签 + 第2列描述合并剩余列
                                                                    const labelCell = String(row?.[0] ?? "").trim();
                                                                    const isLabelRow = isMatrixTable && (labelCell === "红色" || labelCell === "黄色" || labelCell === "绿色");
                                                                    const labelBg: any = labelCell === "红色" ? { background: "#FF0000" }
                                                                        : labelCell === "黄色" ? { background: "#FFFF00" }
                                                                        : labelCell === "绿色" ? { background: "#00B050" } : {};
                                                                    return (
                                                                        <tr key={r}>
                                                                            {mergeRow ? (
                                                                                <td colSpan={maxCols} style={{ textAlign: "center", fontWeight: "bold", background: "#f5f8fc" }}>
                                                                                    <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 4 }}
                                                                                        value={row[0] ?? ""} disabled={isView}
                                                                                        style={{ textAlign: "center", fontWeight: "bold" }}
                                                                                        onChange={(e) => setBlockCell(bi, r, 0, e.target.value)} />
                                                                                </td>
                                                                            ) : isLabelRow ? (
                                                                                <>
                                                                                    <td style={labelBg}>
                                                                                        <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 4 }}
                                                                                            value={row[0] ?? ""} disabled={isView}
                                                                                            style={{ textAlign: "left", fontWeight: "bold" }}
                                                                                            onChange={(e) => setBlockCell(bi, r, 0, e.target.value)} />
                                                                                    </td>
                                                                                    <td colSpan={maxCols - 1}>
                                                                                        <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 4 }}
                                                                                            value={row[1] ?? ""} disabled={isView}
                                                                                            onChange={(e) => setBlockCell(bi, r, 1, e.target.value)} />
                                                                                    </td>
                                                                                </>
                                                                            ) : (
                                                                                (row || []).map((cell: any, ci: number) => {
                                                                                    // 分数单元格着色：仅风险矩阵表，数字1~25按风险值分色
                                                                                    let cellBg: any = {};
                                                                                    if (isMatrixTable && !isHeaderRow && ci >= 2) {
                                                                                        const num = parseInt(String(cell ?? "").trim(), 10);
                                                                                        if (!isNaN(num) && num > 0) {
                                                                                            if (num <= 5) cellBg = { background: "#00B050" };
                                                                                            else if (num <= 12) cellBg = { background: "#FFFF00" };
                                                                                            else cellBg = { background: "#FF0000" };
                                                                                        }
                                                                                    }
                                                                                    return (
                                                                                    <td key={ci} className={isHeaderRow ? "head" : ""} style={cellBg}>
                                                                                        <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                            value={cell ?? ""} disabled={isView}
                                                                                            onChange={(e) => setBlockCell(bi, r, ci, e.target.value)} />
                                                                                    </td>
                                                                                    );
                                                                                })
                                                                            )}
                                                                            {!isView && <td className="pdp-row-op">{tb.length > 1 && <DeleteOutlined title="删除该行" onClick={() => delBlockRow(bi, r)} />}</td>}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                );
                                            }
                                            const textVal = block?.text || "";
                                            return (
                                                <div className="pdp-field" key={`blk-${bi}`}>
                                                    <div className="pdp-label">正文 {bi + 1}</div>
                                                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 24 }}
                                                        value={textVal} disabled={isView}
                                                        placeholder="本段正文内容，可多行"
                                                        onChange={(e) => setBlockText(bi, e.target.value)} />
                                                </div>
                                            );
                                        })}
                                        {!isView && (
                                            <Space style={{ marginTop: 8 }}>
                                                <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addBlockTable}>添加表格</Button>
                                                <Button className="pdp-add-table" type="dashed" onClick={addBlockText}>添加正文</Button>
                                            </Space>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {/* 正文 */}
                                        <div className="pdp-field">
                                            <div className="pdp-label">正文</div>
                                            <Input.TextArea autoSize={{ minRows: 3, maxRows: 24 }}
                                                value={active.text ?? ""} disabled={isView}
                                                placeholder="本章节正文内容，可多行"
                                                onChange={(e) => patchNode(active._key, { text: e.target.value })} />
                                        </div>

                                        {/* 表格 */}
                                        {(active.tables || []).map((tb: any[], ti: number) => {
                                            const isAppendix = active.ref_type === "appendix" || active.ref_type === "runtime_env";
                                            // 整行合并：整行只有第一格有内容
                                            const isFullRow = (row: any[]) => row.length > 1
                                                && String(row?.[0] ?? "").trim() !== ""
                                                && row.slice(1).every((c: any) => String(c ?? "").trim() === "");
                                            return (
                                            <div className="pdp-table-block" key={ti}>
                                                <div className="pdp-table-bar">
                                                    <span className="pdp-label">表格 {ti + 1}</span>
                                                    {!isView && (
                                                        <Space size={4}>
                                                            <Button size="small" onClick={() => addRow(ti)}>＋行</Button>
                                                            <Button size="small" onClick={() => addCol(ti)}>＋列</Button>
                                                            <Button size="small" danger onClick={() => delTable(ti)}>删除此表</Button>
                                                        </Space>
                                                    )}
                                                </div>
                                                <table className="pdp-grid" style={{ tableLayout: "fixed", width: "100%" }}>
                                                    {(() => {
                                                        const maxCols = Math.max(...tb.map((row: any[]) => (row || []).length));
                                                        if (maxCols <= 1) return null;
                                                        let widths: string[];
                                                        if (maxCols === 2) {
                                                            widths = ["20%", "80%"];
                                                        } else if (maxCols === 3) {
                                                            widths = ["10%", "55%", "35%"];
                                                        } else if (maxCols === 4) {
                                                            widths = ["12%", "18%", "35%", "35%"];
                                                        } else {
                                                            widths = new Array(maxCols).fill(`${100/maxCols}%`);
                                                        }
                                                        return (
                                                            <colgroup>
                                                                {widths.map((w, i) => <col key={`c${i}`} style={{ width: w }} />)}
                                                            </colgroup>
                                                        );
                                                    })()}
                                                    <tbody>
                                                        {tb.map((row: any[], r: number) => {
                                                            const maxCols = Math.max(...tb.map((rr: any[]) => (rr || []).length));
                                                            const mergeRow = row.length === 1 && String(row[0] ?? "").trim() !== "";
                                                            const isHeaderRow = !mergeRow && (r === 0 || (r === 1 && tb[0].length === 1));
                                                            return (
                                                                <tr key={r}>
                                                                    {mergeRow ? (
                                                                        <td colSpan={maxCols} style={{ textAlign: "center", fontWeight: "bold", background: "#f5f8fc" }}>
                                                                            <Input.TextArea
                                                                                className="pdp-cell"
                                                                                autoSize={{ minRows: 1, maxRows: 4 }}
                                                                                value={row[0] ?? ""}
                                                                                disabled={isView}
                                                                                style={{ textAlign: "center", fontWeight: "bold" }}
                                                                                onChange={(e) => setCell(ti, r, 0, e.target.value)}
                                                                            />
                                                                        </td>
                                                                    ) : (
                                                                        row.map((cell: any, ci: number) => (
                                                                            <td key={ci} className={isHeaderRow ? "head" : ""}>
                                                                                {typeof cell === "string" && cell.startsWith("data:image") ? (
                                                                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                                                                        <img src={cell} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain" }} />
                                                                                        {!isView && <DeleteOutlined style={{ color: "#c00", cursor: "pointer" }} onClick={() => setCell(ti, r, ci, "")} />}
                                                                                    </span>
                                                                                ) : (
                                                                                    <Input.TextArea className="pdp-cell" autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                        value={cell ?? ""} disabled={isView}
                                                                                        onChange={(e) => setCell(ti, r, ci, e.target.value)} />
                                                                                )}
                                                                                {!isView && isHeaderRow && row.length > 1 && (
                                                                                    <DeleteOutlined className="pdp-col-del" title="删除该列" onClick={() => delCol(ti, ci)} />
                                                                                )}
                                                                            </td>
                                                                        ))
                                                                    )}
                                                                    {!isView && <td className="pdp-row-op">{tb.length > 1 && <DeleteOutlined title="删除该行" onClick={() => delRow(ti, r)} />}</td>}
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                            );
                                        })}

                                        {!isView && (
                                            <Button className="pdp-add-table" type="dashed" icon={<FileAddOutlined />} onClick={addTable}>添加表格</Button>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};