import { Button, Input, Space, Spin, Upload, message } from "antd";
import { PlusOutlined, DeleteOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiPtrDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiVersionRule from "@/api/ApiVersionRule";
import * as ApiRuntime from "@/api/ApiProdRuntimeEnv";
import * as ApiDocFile from "@/api/ApiDocFile";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

const IMG_CATEGORY_LABEL: Record<string, string> = {
    img_struct: "体系结构图",
    img_topo: "物理拓扑图",
    img_ui: "用户界面关系图",
    img_home: "主页面图示",
    img_flow: "网络安全流程图",
};

// 正文图题关键词 -> 图表文件管理分类
const CAPTION_CATS: [string, string][] = [
    ["用户界面关系图", "img_ui"],
    ["主页面图示", "img_home"],
    ["物理拓扑图", "img_topo"],
    ["体系结构图", "img_struct"],
];

// 仅这些分类允许在文档内上传（写回图表文件管理）；其余为只读预览
const UPLOADABLE_CATS = new Set(["img_ui", "img_home"]);

// 扫描节点正文图题行（图N xxx），返回 [{caption, category}]
const getNodeFigures = (node: any): { caption: string; category: string }[] => {
    const figs: { caption: string; category: string }[] = [];
    String(node?.body || "").split("\n").forEach((ln: string) => {
        const s = ln.trim();
        if (/^图\s*\d/.test(s)) {
            const hit = CAPTION_CATS.find(([kw]) => s.includes(kw));
            if (hit && !figs.some((f) => f.category === hit[1])) {
                figs.push({ caption: s, category: hit[1] });
            }
        }
    });
    return figs;
};

const NAMING_ANCHOR = "软件完整版本及说明";

type ImgAnchor = { kind: "naming" | "docfile"; category?: string; caption?: string; lineIndex: number };

// 含图章节：返回图片锚点（图片插入在该行之后），按出现顺序
const getImageAnchors = (node: any): ImgAnchor[] => {
    const anchors: ImgAnchor[] = [];
    const lines = String(node?.body || "").split("\n");
    const isNaming = node?.ref_type === "naming_rule" || String(node?.title || "").includes("版本命名规则");
    if (isNaming) {
        const idx = lines.findIndex((l) => l.trim().startsWith(NAMING_ANCHOR));
        if (idx >= 0) anchors.push({ kind: "naming", lineIndex: idx });
    } else if (node?.ref_type === "appendix") {
        lines.forEach((l, idx) => {
            const s = l.trim();
            if (/^图\s*\d/.test(s)) {
                const hit = CAPTION_CATS.find(([kw]) => s.includes(kw));
                if (hit && !anchors.some((a) => a.category === hit[1])) {
                    anchors.push({ kind: "docfile", category: hit[1], caption: s, lineIndex: idx });
                }
            }
        });
    }
    return anchors;
};

// 按锚点把正文拆成 N+1 段（每段含其末尾的锚点行；图片排在该段之后）
const splitBodyByAnchors = (body: string, anchors: ImgAnchor[]): string[] => {
    const lines = String(body || "").split("\n");
    const idxs = anchors.map((a) => a.lineIndex).sort((a, b) => a - b);
    const parts: string[] = [];
    let start = 0;
    idxs.forEach((ai) => {
        parts.push(lines.slice(start, ai + 1).join("\n"));
        start = ai + 1;
    });
    parts.push(lines.slice(start).join("\n"));
    return parts;
};

let _seq = 0;
const genKey = () => `n${Date.now().toString(36)}_${(_seq++).toString(36)}`;

// 由「基础数据-版本命名规则」全局配置生成「版本命名规则」章节正文
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

// 「版本命名规则」章节固定示意图（只读）
const NamingRuleDiagram = () => (
    <svg viewBox="0 0 470 290" style={{ width: 470, maxWidth: "100%", margin: "4px 0 8px" }}>
        <defs>
            <marker id="ptr-vr-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
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
        <polyline points="195,56 195,87 300,87" fill="none" stroke="#333" markerEnd="url(#ptr-vr-arrow)" />
        <polyline points="145,56 145,142 300,142" fill="none" stroke="#333" markerEnd="url(#ptr-vr-arrow)" />
        <polyline points="95,56 95,197 300,197" fill="none" stroke="#333" markerEnd="url(#ptr-vr-arrow)" />
        <polyline points="45,56 45,252 300,252" fill="none" stroke="#333" markerEnd="url(#ptr-vr-arrow)" />
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

// 编号：封面、附录不编号；其余正文顶级 1/2/3，子级 1.1...
const computeNumbers = (nodes: any[]): Record<string, string> => {
    const map: Record<string, string> = {};
    let bodyIdx = 0;
    (nodes || []).forEach((n: any) => {
        if (n.ref_type === "cover" || n.ref_type === "appendix") {
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
        docImages: {} as Record<string, string>,
        uploadingCat: "",
        products: [] as any[],
    });

    // 封面=产品名称；产品版本=完整/发布版本；版本命名规则=全局配置（均始终取最新覆盖）
    const fillAuto = (nodes: any[], info: { name?: string; full?: string; release?: string; namingBody?: string; env?: any; overview?: string }): any[] => {
        const name = String(info.name || "").trim();
        const full = String(info.full || "").trim();
        const release = String(info.release || "").trim();
        const overview = String(info.overview || "").trim();
        const env = info.env || null;
        const overwriteCol1 = (table: any[], map: Record<string, any>) =>
            table.map((row: any[]) => {
                if (!Array.isArray(row) || row.length < 2) return row;
                const k = String(row[0]).trim();
                if (map[k] !== undefined && String(map[k] || "").trim()) {
                    const next = [...row];
                    next[1] = map[k];
                    return next;
                }
                return row;
            });
        const overwriteRow1 = (table: any[], v1: any, v2: any) =>
            table.map((row: any[], ri: number) => {
                if (ri !== 1 || !Array.isArray(row) || row.length < 3) return row;
                const next = [...row];
                if (String(v1 || "").trim()) next[1] = v1;
                if (String(v2 || "").trim()) next[2] = v2;
                return next;
            });
        const fix = (n: any): any => {
            let body = n.body;
            let tables = n.tables;
            const ref = n.ref_type;
            const t = stripNum(n.title);
            if (ref === "cover") {
                if (name) body = name;
            } else if (ref === "prod_version" || t === "产品版本") {
                if (full || release) body = `软件完整版本：${full}\n软件发布版本：${release}`;
            } else if ((ref === "naming_rule" || t === "版本命名规则") && info.namingBody) {
                body = info.namingBody;
            } else if (ref === "ui_relation" || t.includes("用户界面关系图")) {
                // 用户界面关系图文案取「总体描述」，始终覆盖补位（为空则仅保留图题，清掉旧产品文案）
                body = `图2 用户界面关系图\n${overview}\n图3 主页面图示`;
            } else if (env && (ref === "runtime" || t === "运行环境")) {
                if (String(env.arch || "").trim()) body = env.arch;
            } else if (env && ref === "rt_srv_hw") {
                tables = (n.tables || []).map((tb: any[]) => overwriteCol1(tb, { CPU: env.srv_cpu, "内存": env.srv_memory, GPU: env.srv_gpu, "硬盘": env.srv_disk, "网卡": env.srv_nic }));
            } else if (env && ref === "rt_srv_sw") {
                tables = (n.tables || []).map((tb: any[]) => overwriteRow1(tb, env.srv_os, env.srv_cuda));
            } else if (env && ref === "rt_client") {
                tables = (n.tables || []).map((tb: any[]) => overwriteCol1(tb, { CPU: env.cli_cpu, "内存": env.cli_memory, "显示器分辨率": env.cli_resolution, "操作系统": env.cli_os, "浏览器": env.cli_browser }));
            } else if (env && ref === "rt_net") {
                tables = (n.tables || []).map((tb: any[]) => overwriteRow1(tb, env.net_lan, env.net_wan));
            }
            return { ...n, body, tables, children: (n.children || []).map(fix) };
        };
        return (nodes || []).map(fix);
    };

    // 附录章节的图（体系结构图/物理拓扑图）从「图表文件管理」按产品取，仅预览用
    const loadDocImages = (productId: number, sections: any[]) => {
        const cats = new Set<string>();
        const walk = (nodes: any[]) => (nodes || []).forEach((n: any) => {
            if (n.img_category) cats.add(n.img_category);
            getNodeFigures(n).forEach((f) => cats.add(f.category));
            walk(n.children || []);
        });
        walk(sections);
        const catList = [...cats];
        if (!catList.length) return;
        Promise.all(catList.map((cat) =>
            ApiDocFile.list_doc_file(cat, { product_id: productId, page_index: 0, page_size: 50 })
                .then((res: any) => {
                    const first = res.code === Api.C_OK ? (res.data?.rows || [])[0] : null;
                    return [cat, first?.file_url ? `/${first.file_url}` : ""] as [string, string];
                })
                .catch(() => [cat, ""] as [string, string])
        )).then((pairs) => {
            const images: Record<string, string> = {};
            const bust = Date.now();
            pairs.forEach(([cat, url]) => { if (url) images[cat] = `${url}?t=${bust}`; });
            dispatch({ docImages: images });
        });
    };

    // 按产品重新获取并填充所有自动获取内容（封面/版本/命名规则/运行环境/总体描述）
    const autofill = (productId: number, secs: any[]): Promise<any[]> =>
        new Promise((resolve) => {
            if (!productId) { resolve(secs); return; }
            Promise.all([
                ApiProduct.get_product({ id: productId }).catch(() => null),
                ApiVersionRule.get_version_rule().catch(() => null),
                ApiRuntime.get_prod_runtime_env({ prod_id: productId }).catch(() => null),
            ]).then(([pr, vr, rt]: any[]) => {
                const prod = pr && pr.code === Api.C_OK ? (pr.data || {}) : {};
                const vrContent = vr && vr.code === Api.C_OK ? (vr.data && vr.data.content) : null;
                const env = rt && rt.code === Api.C_OK ? (rt.data || null) : null;
                const out = fillAuto(secs, {
                    name: prod.name,
                    full: prod.full_version,
                    release: prod.release_version,
                    namingBody: vrContent ? buildNamingBody(vrContent) : "",
                    overview: prod.overall_desc,
                    env,
                });
                resolve(out);
            }).catch(() => resolve(secs));
        });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_ptr_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const sections = ensureKeys((doc.content && doc.content.sections) || []);
            if (doc.product_id) loadDocImages(doc.product_id, sections);
            autofill(doc.product_id, sections).then((secs) => {
                dispatch({ loading: false, doc, sections: secs, activeKey: findNode(secs, data.activeKey) ? data.activeKey : firstKey(secs) });
            });
        });
    };

    // 修改产品名称/版本后，重新拉取并填充所有自动获取内容（保留人工编辑的非自动字段）
    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        if (newId) loadDocImages(newId, data.sections);
        autofill(newId, data.sections).then((secs) => dispatch({ loading: false, sections: secs }));
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

    // 在文档内上传/替换图片：写回「图表文件管理」对应分类（按产品全局共享）
    const uploadDocImage = (category: string, file: any) => {
        const productId = data.doc.product_id;
        if (!productId) {
            message.error("该文档未关联产品，无法上传");
            return false;
        }
        if (!/^image\//.test(file.type || "")) {
            message.error("请选择图片文件");
            return false;
        }
        if (file.size > 8 * 1024 * 1024) {
            message.error("图片不能超过 8MB");
            return false;
        }
        dispatch({ uploadingCat: category });
        ApiDocFile.list_doc_file(category, { product_id: productId, page_index: 0, page_size: 1 })
            .then((res: any) => {
                const existing = res.code === Api.C_OK ? (res.data?.rows || [])[0] : null;
                return existing
                    ? ApiDocFile.update_doc_file(category, { id: existing.id, product_id: productId, file })
                    : ApiDocFile.add_doc_file(category, { product_id: productId, file });
            })
            .then((res: any) => {
                dispatch({ uploadingCat: "" });
                if (res.code === Api.C_OK) {
                    message.success(`上传成功，已保存到「图表文件管理 · ${IMG_CATEGORY_LABEL[category] || ""}」`);
                    loadDocImages(productId, data.sections);
                } else {
                    message.error(res.msg || "上传失败");
                }
            })
            .catch(() => {
                dispatch({ uploadingCat: "" });
                message.error("上传失败");
            });
        return false;
    };

    // 含图章节：编辑某一段正文，重新拼回整段 body（图片位置由锚点行决定）
    const setSegment = (i: number, val: string) => {
        const anchors = getImageAnchors(active);
        const parts = splitBodyByAnchors(active.body, anchors);
        parts[i] = val;
        patchNode(active._key, { body: parts.join("\n") });
    };

    // 段之间渲染对应图片块（示意图 / 取自图表文件管理的图片，可上传）
    const renderImageBlock = (anchor: ImgAnchor) => {
        if (anchor.kind === "naming") {
            return (
                <div className="pdp-field">
                    <div className="pdp-label">软件完整版本及说明（示意图，导出自动包含）</div>
                    <NamingRuleDiagram />
                </div>
            );
        }
        const cat = anchor.category as string;
        return (
            <div className="pdp-field">
                <div className="pdp-label">
                    {anchor.caption}（{IMG_CATEGORY_LABEL[cat] || "图片"}，取自「图表文件管理」，导出自动嵌入）
                </div>
                {data.docImages[cat] ? (
                    <img
                        src={data.docImages[cat]}
                        alt={IMG_CATEGORY_LABEL[cat] || ""}
                        style={{ maxWidth: "100%", border: "1px solid #eee", borderRadius: 4 }}
                    />
                ) : (
                    <div style={{ color: "#999", padding: "8px 0" }}>
                        未在「图表文件管理 - {IMG_CATEGORY_LABEL[cat] || ""}」找到该产品的图片。
                    </div>
                )}
                {!readonly && UPLOADABLE_CATS.has(cat) && (
                    <div style={{ marginTop: 10 }}>
                        <Upload beforeUpload={(file: any) => uploadDocImage(cat, file)} showUploadList={false} accept="image/*">
                            <Button icon={<UploadOutlined />} loading={data.uploadingCat === cat}>
                                {data.docImages[cat] ? "替换图片" : "上传图片"}
                            </Button>
                        </Upload>
                        <span style={{ color: "#999", marginLeft: 10 }}>
                            上传后保存到「图表文件管理 · {IMG_CATEGORY_LABEL[cat]}」（按产品全局共享）
                        </span>
                    </div>
                )}
            </div>
        );
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = { sections: stripKeys(data.sections) };
        Api.update_ptr_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
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
            const res: any = await Api.export_ptr_doc({ id });
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
                    产品技术要求
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
                    <Button onClick={() => navigate("/ptr_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {!readonly && (
                            <div className="pdp-nav-hint">点章节改名/编辑，右侧 + 加子章节、🗑 删除；编号按层级自动生成（封面/附录不编号）</div>
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
                                        placeholder="只填名称，如：性能指标"
                                        onChange={(e) => patchNode(active._key, { title: e.target.value })}
                                    />
                                </div>
                                {(() => {
                                    const anchors = getImageAnchors(active);
                                    if (anchors.length === 0) {
                                        return (
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
                                        );
                                    }
                                    const parts = splitBodyByAnchors(active.body, anchors);
                                    const segLabel = (i: number) =>
                                        parts.length === 1 ? "正文" : i === 0 ? "正文（图前）" : i === parts.length - 1 ? "正文（图后）" : "正文（图间）";
                                    return parts.map((p, i) => (
                                        <div key={`seg-${i}`}>
                                            <div className="pdp-field">
                                                <div className="pdp-label">{segLabel(i)}</div>
                                                <Input.TextArea
                                                    autoSize={{ minRows: 2, maxRows: 20 }}
                                                    value={p}
                                                    disabled={readonly}
                                                    placeholder={i === 0 ? "图片前的正文内容，可多行" : "图片后的正文内容，可多行"}
                                                    onChange={(e) => setSegment(i, e.target.value)}
                                                />
                                            </div>
                                            {i < anchors.length && renderImageBlock(anchors[i])}
                                        </div>
                                    ));
                                })()}

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
                                                                <Input.TextArea
                                                                    className="pdp-cell"
                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                    value={cell ?? ""}
                                                                    disabled={readonly}
                                                                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                />
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
