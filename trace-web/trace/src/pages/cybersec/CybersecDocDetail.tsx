import { Button, Card, Form, Input, Modal, Select, Space, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sprintf } from "sprintf-js";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiCybersecDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiProdCst from "@/api/ApiProdCst";
import * as ApiProdRcm from "@/api/ApiProdRcm";
import * as ApiProdHaz from "@/api/ApiProdHaz";
import * as ApiDocFile from "@/api/ApiDocFile";
import "../risk_mgmt/RiskMgmtDocDetail.less";

const emptyContent = { sections: [], productName: "" };

const CYBERSEC_SCORE_TABLE = [
    ["风险值", "", "", "严重度", "", "", "", ""],
    ["", "", "", "可忽略 A", "轻度 B", "严重 C", "危重的 D", "灾难性的 E"],
    ["发生概率", "经常", "5", "5A", "5B", "5C", "5D", "5E"],
    ["", "有时", "4", "4A", "4B", "4C", "4D", "4E"],
    ["", "偶然", "3", "3A", "3B", "3C", "3D", "3E"],
    ["", "很少", "2", "2A", "2B", "2C", "2D", "2E"],
    ["", "非常少", "1", "1A", "1B", "1C", "1D", "1E"],
    ["红色", "不可接受：这类网络安全风险本质上不可接受，必须寻求风险降低措施。", "", "", "", "", "", ""],
    ["橙色", "可控：需进一步降低到合理可行的最低限度才可视为可接受。", "", "", "", "", "", ""],
    ["绿色", "可接受：这类风险实际上可接受。", "", "", "", "", "", ""],
];

const createCoverSection = () => ({
    title: "网络安全风险管理报告",
    ref_type: "cover",
    children: [],
    tables: [[
        ["编制部门", "", "文件版本", ""],
        ["编制人", "", "日期", ""],
        ["审核人", "", "日期", ""],
        ["批准人", "", "日期", ""],
        ["生效日期", "", "", ""],
    ]],
});

const createRevisionSection = () => ({
    title: "文件修订记录",
    ref_type: "revision",
    children: [],
    tables: [[
        ["修改日期", "版本号", "修订说明", "修订人", "批准人"],
        ["", "", "", "", ""],
    ]],
});

const templateContent = {
    sections: [
        createCoverSection(),
        createRevisionSection(),
        {
            title: "1 概述",
            children: [
                { title: "1.1 目的", children: [] },
                { title: "1.2 产品描述", children: [] },
                { title: "1.3 适用范围", children: [] },
                { title: "1.4 系统架构和安全实现", children: [] },
            ],
        },
        {
            title: "2 阶段活动", ref_type: "stage_activity", children: [],
            tables: [[["阶段", "开始", "结束", "结果"], ["", "", "", ""]]],
        },
        { title: "3 关联文件", children: [] },
        {
            title: "4 视图分析与威胁建模", ref_type: "view_analysis",
            children: [
                { title: "4.1 系统全局视图", children: [] },
                { title: "4.2 多患者危害视图", children: [] },
                { title: "4.3 安全用例视图", children: [] },
                { title: "4.4 可更新性视图", children: [] },
                { title: "4.5 威胁建模 STRIDE", ref_type: "stride_threats", children: [] },
            ],
        },
        {
            title: "5 风险评估",
            children: [
                { title: "5.1 评分标准", children: [], tables: [JSON.parse(JSON.stringify(CYBERSEC_SCORE_TABLE))] },
                {
                    title: "5.2 风险评估及控制措施（RCM）",
                    children: [
                        { title: "5.2.1 内部 RCM", ref_type: "cybersec_controls_internal", children: [] },
                        { title: "5.2.2 SBOM RCM", ref_type: "cybersec_controls_sbom", children: [] },
                        { title: "5.2.3 网络安全扫描 RCM", ref_type: "cybersec_controls_scan", children: [] },
                    ],
                },
                { title: "5.3 残余风险评估", ref_type: "residual_risk", children: [] },
            ],
        },
        {
            title: "6 维护更新", ref_type: "maintenance",
            children: [
                { title: "6.1 设计保证", children: [] },
                { title: "6.2 异常情况响应", children: [] },
                { title: "6.3 安全更新策略", children: [] },
                { title: "6.4 用户指导", children: [] },
            ],
        },
        { title: "7 威胁缓解措施追溯", ref_type: "traceability", children: [] },
        { title: "8 参考标准", children: [] },
    ],
    productName: "",
};

const makeRowKey = () => `${Date.now()}-${Math.random()}`;
const cloneTemplateContent = () => JSON.parse(JSON.stringify(templateContent));
const sectionKey = (section: any) => section?._key || section?.title || section?.ref_type || "";
const normalizeTitleText = (value: any) => String(value || "").replace(/\s+/g, "");

const isCoverSection = (section: any) => section?.ref_type === "cover" || normalizeTitleText(section?.title) === "网络安全风险管理报告";
const isRevisionSection = (section: any) => section?.ref_type === "revision" || normalizeTitleText(section?.title) === "文件修订记录";
const isStrideSection = (section: any) => section?.ref_type === "stride_threats";
const isTraceabilitySection = (section: any) => section?.ref_type === "traceability";
const isFlowDiagramSection = (section: any) => section?.ref_type === "flow_diagram" || normalizeTitleText(section?.title).endsWith("系统总体架构");

const RCM_CODE_RE = /RCM\d+/g;
const buildRcmCodeMap = (prodRcms: any[]): Map<string, string> => {
    const map = new Map<string, string>();
    (prodRcms || []).forEach((row: any) => {
        const code = String(row?.code || "").trim();
        const desc = String(row?.description || "").trim();
        if (code && desc) map.set(code, desc);
    });
    return map;
};
const tableHasThreatColumn = (rows: any[]): boolean => (
    Array.isArray(rows) && rows.length > 0 && (rows[0] || []).some((cell: any) => normalizeTitleText(cell).includes("威胁编号"))
);
// 产品 CST 的 RCM 关联：威胁编号 -> rcm_codes（仅取非空）
const buildCstRcmMap = (prodCsts: any[]): Map<string, string> => {
    const map = new Map<string, string>();
    (prodCsts || []).forEach((row: any) => {
        const code = String(row?.code || "").trim();
        const rcm = String(row?.rcm_codes || "").trim();
        if (code && rcm) map.set(code, rcm);
    });
    return map;
};
// 把 RCM 编号串解析为产品 RCM 描述（命中不到的编号原样保留）
const resolveRcmCodesText = (text: any, descMap: Map<string, string>): string => {
    const raw = String(text ?? "");
    const codes = raw.match(RCM_CODE_RE);
    if (!codes || codes.length === 0) return raw;
    return codes.map((code) => descMap.get(code) || code).join(" ");
};
// 在威胁表头中定位「威胁编号」列与「缓解措施(RCM)」列索引
const findThreatTableCols = (rows: any[]): { codeCol: number; rcmCol: number } => {
    const header = (rows && rows[0]) || [];
    let codeCol = -1;
    let rcmCol = -1;
    header.forEach((cell: any, idx: number) => {
        const t = normalizeTitleText(cell);
        if (codeCol < 0 && t.includes("威胁编号")) codeCol = idx;
        if (t.includes("缓解措施") || t.includes("RCM")) rcmCol = idx;
    });
    return { codeCol, rcmCol };
};
// 威胁表表头合并还原（仅显示层）：横向连续空串→colspan，表头内上下同文本→rowspan；数据行(THREAT-xxx)不参与
const computeHeaderMergePlan = (rows: any[], codeCol: number) => {
    const list = Array.isArray(rows) ? rows : [];
    const width = list.reduce((m: number, r: any[]) => Math.max(m, (r || []).length), 0);
    let headerRows = 0;
    for (let r = 0; r < list.length; r += 1) {
        const c0 = codeCol >= 0 ? String(list[r]?.[codeCol] ?? "").trim() : "";
        if (/^THREAT/i.test(c0)) break;
        headerRows += 1;
    }
    const skip: boolean[][] = list.map(() => new Array(width).fill(false));
    const span: ({ colspan: number; rowspan: number } | null)[][] = list.map(() => new Array(width).fill(null));
    const txt = (r: number, c: number) => String(list[r]?.[c] ?? "");
    for (let r = 0; r < headerRows; r += 1) {
        for (let c = 0; c < width; c += 1) {
            if (skip[r][c]) continue;
            let colspan = 1;
            while (c + colspan < width && txt(r, c + colspan) === "") {
                skip[r][c + colspan] = true;
                colspan += 1;
            }
            let rowspan = 1;
            if (txt(r, c) !== "") {
                while (r + rowspan < headerRows && txt(r + rowspan, c) === txt(r, c)) {
                    for (let cc = c; cc < c + colspan; cc += 1) skip[r + rowspan][cc] = true;
                    rowspan += 1;
                }
            }
            span[r][c] = { colspan, rowspan };
        }
    }
    return { headerRows, skip, span };
};
// 单元格按产品 RCM 编号刷新描述：仅当至少一个编号能在产品 RCM 命中时才重写；否则原样保留（不丢数据）
const refreshRcmCell = (cell: any, map: Map<string, string>): { value: any; changed: boolean } => {
    const text = String(cell ?? "");
    const codes = text.match(RCM_CODE_RE);
    if (!codes || codes.length === 0) return { value: cell, changed: false };
    if (!codes.some((code) => map.has(code))) return { value: cell, changed: false };
    const next = codes.map((code) => map.get(code) || code).join(" ");
    return { value: next, changed: next !== text };
};
const refreshRcmInSections = (sections: any[], map: Map<string, string>): { sections: any[]; changed: boolean } => {
    let changed = false;
    const walk = (items: any[] = []): any[] => (items || []).map((section) => {
        let nextSection = section;
        if (Array.isArray(section.tables) && section.tables.some((rows: any[]) => tableHasThreatColumn(rows))) {
            const tables = section.tables.map((rows: any[]) => {
                if (!tableHasThreatColumn(rows)) return rows;
                return (rows || []).map((row: any[]) => (row || []).map((cell: any) => {
                    const res = refreshRcmCell(cell, map);
                    if (res.changed) changed = true;
                    return res.value;
                }));
            });
            nextSection = { ...nextSection, tables };
        }
        const children = walk(section.children || []);
        if (children !== section.children) nextSection = { ...nextSection, children };
        return nextSection;
    });
    const result = walk(sections || []);
    return { sections: result, changed };
};
const controlKindOf = (section: any): "internal" | "sbom" | "scan" | "" => {
    switch (section?.ref_type) {
        case "cybersec_controls_internal": return "internal";
        case "cybersec_controls_sbom": return "sbom";
        case "cybersec_controls_scan": return "scan";
        default: return "";
    }
};

const ensureFrontMatterSections = (content: any) => {
    const nextContent = JSON.parse(JSON.stringify({ ...emptyContent, ...(content || {}) }));
    const sections = Array.isArray(nextContent.sections) ? nextContent.sections : [];
    const cover = sections.find(isCoverSection) || createCoverSection();
    const revision = sections.find(isRevisionSection) || createRevisionSection();
    const bodySections = sections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
    nextContent.sections = [cover, revision, ...bodySections];
    return nextContent;
};

const stripSectionNo = (title: any) => String(title || "").replace(/^[0-9０-９.．\s、]+/, "").trim();

const buildProductDescription = (product: any) => [
    `产品名称：${product?.name || ""}`,
    `产品型号：${product?.type_code || ""}`,
    `完整版本：${product?.full_version || ""}`,
].join("\n");

const buildDefaultSectionTextMap = (product: any): Record<string, string> => {
    const pname = product?.name || "";
    return {
        "目的": `本报告的目的是按 IEC 62304 / IEC 81001-5-1 / FDA 网络安全要求，识别、评估并控制${pname}的网络安全威胁与风险，确保在产品全生命周期内对网络安全风险进行监控与维护。`,
        "系统架构和安全实现": `描述${pname}的系统总体架构、核心组件、数据流、外部连接、信任边界及已实现的安全控制措施。`,
        "设计保证": `通过设计评审、威胁建模、安全测试与代码审计等活动，保证网络安全设计的充分性与有效性。`,
        "异常情况响应": `定义网络安全事件/漏洞的发现、上报、评估、修复与发布流程，确保异常情况得到及时响应。`,
        "安全更新策略": `定义安全更新的类型、策略、频率、回退与兼容性要求，保证网络安全更新可控可追溯。`,
        "用户指导": `面向用户提供网络安全使用、配置、维护与事件响应的指导说明。`,
        "参考标准": `IEC 62304 医疗器械软件 软件生存周期过程\nIEC 81001-5-1 健康软件与健康IT系统安全、有效与可信\nGB/T 42062-2022 医疗器械 风险管理对医疗器械的应用\n《医疗器械网络安全注册审查指导原则》（2022年第7号）\nFDA - Cybersecurity in Medical Devices`,
    };
};

const fillProductTextSections = (content: any, product: any) => {
    const nextContent = ensureFrontMatterSections(content);
    const defaultMap = buildDefaultSectionTextMap(product);
    const fill = (sections: any[] = []) => {
        (sections || []).forEach((section: any) => {
            const key = stripSectionNo(section.title);
            const hasText = String(section.text || "").trim().length > 0;
            if (!hasText) {
                if (key === "适用范围") {
                    section.text = product?.scope || "";
                } else if (key === "产品描述") {
                    section.text = buildProductDescription(product);
                } else if (defaultMap[key] !== undefined) {
                    section.text = defaultMap[key];
                }
            }
            fill(section.children || []);
        });
    };
    fill(nextContent.sections || []);
    return nextContent;
};

const syncProductNameInContent = (content: any, productName?: string) => {
    const nextContent = ensureFrontMatterSections(content);
    nextContent.productName = String(productName || "").trim();
    return nextContent;
};

const syncFileVersionInCover = (content: any, version: any) => {
    const ver = String(version ?? "");
    const nextContent = JSON.parse(JSON.stringify(content || emptyContent));
    (nextContent.sections || []).forEach((section: any) => {
        if (!isCoverSection(section)) return;
        (section.tables || []).forEach((table: any[]) => {
            (table || []).forEach((row: any[]) => {
                for (let i = 0; i + 1 < (row || []).length; i += 1) {
                    if (normalizeTitleText(row[i]) === "文件版本") {
                        row[i + 1] = ver;
                    }
                }
            });
        });
    });
    return nextContent;
};

const SectionList = ({ sections, depth = 0, activeKey, onSelect, onTitleChange, onAddSibling, onAddChild, onDelete, readOnly }: any) => {
    return (
        <>
            {(sections || []).map((section: any) => (
                <div key={sectionKey(section)}>
                    <div
                        className={`risk-mgmt-section-item ${activeKey === sectionKey(section) ? "active" : ""}`}
                        style={{ marginLeft: depth * 14 }}
                        onClick={() => onSelect(section)}>
                        <div className="risk-mgmt-section-item-main">
                            {readOnly ? section.title : (
                                <Input
                                    value={section.title}
                                    onClick={(e) => { e.stopPropagation(); onSelect(section); }}
                                    onChange={(e) => onTitleChange(section, e.target.value)}
                                />
                            )}
                        </div>
                        {!readOnly && (
                            <Space size={4} className="risk-mgmt-section-actions" onClick={(e) => e.stopPropagation()}>
                                <Button size="small" type="link" onClick={() => onAddSibling(section)}>同级</Button>
                                <Button size="small" type="link" onClick={() => onAddChild(section)}>下级</Button>
                                <Button size="small" type="link" danger onClick={() => onDelete(section)}>删除</Button>
                            </Space>
                        )}
                    </div>
                    <SectionList
                        sections={section.children || []}
                        depth={depth + 1}
                        activeKey={activeKey}
                        onSelect={onSelect}
                        onTitleChange={onTitleChange}
                        onAddSibling={onAddSibling}
                        onAddChild={onAddChild}
                        onDelete={onDelete}
                        readOnly={readOnly}
                    />
                </div>
            ))}
        </>
    );
};

const riskLevelOptions = ["不可接受", "可控", "可接受"].map((v) => ({ label: v, value: v }));
const likelihoodOptions = [1, 2, 3, 4, 5].map((v) => ({ label: String(v), value: v }));
const severityOptions = ["A", "B", "C", "D", "E"].map((v) => ({ label: v, value: v }));
const yesNoOptions = [{ label: "是", value: 1 }, { label: "否", value: 0 }];

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isAdd = location.pathname.includes("/add");
    const isView = location.pathname.includes("/view/");
    const [form] = Form.useForm();
    const [matrixForm] = Form.useForm();
    const contentCardRef = useRef<HTMLDivElement>(null);
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        detail: {},
        content: emptyContent,
        products: [],
        activeSectionKey: "",
        selectedProductId: undefined,
        prodCsts: [],
        prodRcms: [],
        prodHazs: [],
        threats: [],
        controlsInternal: [],
        controlsSbom: [],
        controlsScan: [],
        matrixDlg: "",
        matrixEditMode: "add",
        matrixTarget: {},
        matrixSaving: false,
        flowImageUrl: "",
    });

    const loadProducts = () => {
        if ((data.products || []).length > 0) return;
        ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    const loadReferenceData = (productId?: any) => {
        if (!productId) {
            dispatch({ prodCsts: [], prodRcms: [], prodHazs: [] });
            return;
        }
        ApiProdCst.list_prod_cst({ prod_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProdCst.C_OK) dispatch({ prodCsts: res.data?.rows || [] });
        });
        ApiProdRcm.list_prod_rcm({ prod_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProdRcm.C_OK) dispatch({ prodRcms: res.data?.rows || [] });
        });
        ApiProdHaz.list_prod_haz({ prod_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProdHaz.C_OK) dispatch({ prodHazs: res.data?.rows || [] });
        });
    };

    const loadMatrixData = (docId?: any) => {
        if (!docId) {
            dispatch({ threats: [], controlsInternal: [], controlsSbom: [], controlsScan: [] });
            return;
        }
        Api.list_cybersec_threat({ doc_id: docId, view_type: "STRIDE", page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ threats: res.data?.rows || [] });
        });
        Api.list_cybersec_control_internal({ doc_id: docId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ controlsInternal: res.data?.rows || [] });
        });
        Api.list_cybersec_control_sbom({ doc_id: docId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ controlsSbom: res.data?.rows || [] });
        });
        Api.list_cybersec_control_scan({ doc_id: docId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ controlsScan: res.data?.rows || [] });
        });
    };

    useEffect(() => {
        loadProducts();
        if (isAdd) {
            form.resetFields();
            const content = cloneTemplateContent();
            const defaultSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
            dispatch({ detail: {}, content, activeSectionKey: sectionKey(defaultSection) });
            return;
        }
        if (!params.id) return;
        dispatch({ loading: true });
        Api.get_cybersec_doc({ id: params.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const detail = res.data || {};
                let content = syncProductNameInContent(detail.content || emptyContent, detail.product_name);
                content = syncFileVersionInCover(content, detail.version);
                const defaultSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
                form.setFieldsValue(detail);
                dispatch({ loading: false, detail, content, activeSectionKey: sectionKey(defaultSection) });
                loadReferenceData(detail.product_id);
                loadMatrixData(detail.id);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    }, [params.id, isAdd]);

    useEffect(() => {
        if (!isAdd) return;
        loadReferenceData(data.selectedProductId);
    }, [isAdd, data.selectedProductId]);

    useEffect(() => {
        const pid = data.detail?.product_id || data.selectedProductId;
        if (!pid) {
            dispatch({ flowImageUrl: "" });
            return;
        }
        ApiDocFile.list_doc_file("img_flow", { product_id: pid, page_index: 0, page_size: 50 }).then((res: any) => {
            if (res.code === ApiDocFile.C_OK) {
                const rows = res.data?.rows || [];
                const first = rows[0];
                dispatch({ flowImageUrl: first?.file_url ? `/${first.file_url}` : "" });
            }
        });
    }, [data.detail?.product_id, data.selectedProductId]);

    useEffect(() => {
        const map = buildRcmCodeMap(data.prodRcms);
        if (!map.size) return;
        const { sections, changed } = refreshRcmInSections(data.content?.sections || [], map);
        if (changed) dispatch({ content: { ...(data.content || emptyContent), sections } });
    }, [data.prodRcms, data.content]);

    const docId = data.detail?.id;
    const productIdForMatrix = data.detail?.product_id || data.selectedProductId;

    const refreshCurrentDoc = (keepActiveKey?: string) => {
        if (!params.id) return;
        Api.get_cybersec_doc({ id: params.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const detail = res.data || {};
                let content = syncProductNameInContent(detail.content || emptyContent, detail.product_name);
                content = syncFileVersionInCover(content, detail.version);
                form.setFieldsValue(detail);
                const fallbackSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
                dispatch({ detail, content, activeSectionKey: keepActiveKey || sectionKey(fallbackSection) });
                loadReferenceData(detail.product_id);
                loadMatrixData(detail.id);
            }
        });
    };

    const doSave = () => {
        form.validateFields().then((values) => {
            const content = syncProductNameInContent(data.content || emptyContent, data.detail?.product_name || values.product_name);
            dispatch({ saving: true });
            const request = isAdd
                ? Api.add_cybersec_doc({ ...values, content })
                : Api.update_cybersec_doc({ ...data.detail, ...values, content });
            request.then((res: any) => {
                dispatch({ saving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    if (isAdd) {
                        Api.list_cybersec_doc({ product_id: values.product_id, version: values.version, page_index: 0, page_size: 50 }).then((listRes: any) => {
                            const rows = listRes?.data?.rows || [];
                            const matched = rows.find((row: any) => row.product_id === values.product_id && row.version === values.version);
                            if (matched?.id) navigate(`/cybersec_docs/edit/${matched.id}`);
                            else navigate("/cybersec_docs");
                        });
                    } else {
                        refreshCurrentDoc(data.activeSectionKey);
                    }
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const doExport = async () => {
        if (!params.id || data.exporting) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_cybersec_doc({ id: params.id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const initTemplate = () => {
        const currentProductId = data.selectedProductId || data.detail?.product_id;
        const currentProduct = (data.products || []).find((p: any) => p.id === currentProductId);
        const content = fillProductTextSections(cloneTemplateContent(), currentProduct);
        const defaultSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
        dispatch({ content, activeSectionKey: sectionKey(defaultSection) });
        message.success("初始化模版成功");
    };

    // ---------------- 章节树操作 ----------------
    const allSections = data.content.sections || [];
    const frontMatterSections = allSections.filter((section: any) => isCoverSection(section) || isRevisionSection(section));
    const bodySections = allSections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
    const findSectionByKey = (sections: any[] = [], key: string): any => {
        for (const section of sections || []) {
            if (sectionKey(section) === key) return section;
            const child = findSectionByKey(section.children || [], key);
            if (child) return child;
        }
        return null;
    };
    const activeSection = findSectionByKey(bodySections || [], data.activeSectionKey) || bodySections[0];

    const selectSection = (section: any) => {
        dispatch({ activeSectionKey: sectionKey(section) });
        setTimeout(() => contentCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    };

    const updateSections = (updater: (sections: any[]) => any[]) => {
        dispatch({ content: { ...(data.content || emptyContent), sections: updater(data.content.sections || []) } });
    };

    const updateSectionText = (key: string, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => (
            sectionKey(section) === key ? { ...section, text: value } : { ...section, children: update(section.children || []) }
        ));
        updateSections(update);
    };

    const updateSectionTableCell = (key: string, tableIndex: number, rowIndex: number, cellIndex: number, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const tables = Array.isArray(section.tables) ? section.tables.map((table: any[]) => (table || []).map((row: any[]) => [...(row || [])])) : [];
                if (!tables[tableIndex]) tables[tableIndex] = [];
                if (!tables[tableIndex][rowIndex]) tables[tableIndex][rowIndex] = [];
                tables[tableIndex][rowIndex][cellIndex] = value;
                return { ...section, tables };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };

    const cloneSectionTables = (section: any) => (
        Array.isArray(section.tables) ? section.tables.map((table: any[]) => (table || []).map((row: any[]) => [...(row || [])])) : []
    );

    const addSectionTableRow = (key: string, tableIndex: number) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const tables = cloneSectionTables(section);
                if (!tables[tableIndex]) tables[tableIndex] = [];
                const colCount = Math.max(1, ...(tables[tableIndex] || []).map((row: any[]) => (row || []).length));
                tables[tableIndex].push(new Array(colCount).fill(""));
                return { ...section, tables };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };

    const deleteSectionTableRow = (key: string, tableIndex: number, rowIndex: number) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const tables = cloneSectionTables(section);
                if (tables[tableIndex]) tables[tableIndex].splice(rowIndex, 1);
                return { ...section, tables };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };

    const updateSectionImages = (key: string, images: string[]) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => (
            sectionKey(section) === key ? { ...section, images } : { ...section, children: update(section.children || []) }
        ));
        updateSections(update);
    };

    const uploadSectionImage = (section: any, file: File, replaceIndex?: number) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const current = Array.isArray(section.images) ? [...section.images] : [];
            const dataUrl = String(reader.result || "");
            if (replaceIndex !== undefined && replaceIndex >= 0 && replaceIndex < current.length) {
                current[replaceIndex] = dataUrl;
            } else {
                current.push(dataUrl);
            }
            updateSectionImages(sectionKey(section), current);
            message.success("图片已更新，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };

    const deleteSectionImage = (section: any, index: number) => {
        const current = Array.isArray(section.images) ? [...section.images] : [];
        current.splice(index, 1);
        updateSectionImages(sectionKey(section), current);
    };

    const parseSectionNumber = (title?: string) => String(title || "").trim().match(/^([0-9０-９]+(?:[.．][0-9０-９]+)*)/)?.[1]?.replace(/．/g, ".") || "";
    const makeNewSection = (title: string) => ({ _key: makeRowKey(), title, children: [], text: "" });
    const buildNewSectionTitle = (siblings: any[] = [], parent?: any) => {
        const parentNo = parent ? parseSectionNumber(parent.title) : "";
        const numbers = (siblings || [])
            .map((item) => parseSectionNumber(item?.title))
            .filter((no) => parentNo ? (no.startsWith(`${parentNo}.`) && no.split(".").length === parentNo.split(".").length + 1) : (no && no.split(".").length === 1))
            .map((no) => Number(no.split(".").pop()))
            .filter((num) => Number.isFinite(num));
        const nextIndex = Math.max(0, ...numbers) + 1;
        return `${parentNo ? `${parentNo}.${nextIndex}` : `${nextIndex}`} 新目录`;
    };

    const addRootSection = () => {
        const nextSection = makeNewSection(buildNewSectionTitle(bodySections));
        dispatch({ activeSectionKey: sectionKey(nextSection), content: { ...(data.content || emptyContent), sections: [...(data.content.sections || []), nextSection] } });
    };

    const addSiblingSection = (targetSection: any) => {
        const targetKey = sectionKey(targetSection);
        let nextActiveKey = "";
        const update = (sections: any[] = [], parent?: any): any[] => {
            const idx = (sections || []).findIndex((section) => sectionKey(section) === targetKey);
            if (idx >= 0) {
                const nextSection = makeNewSection(buildNewSectionTitle(sections, parent));
                nextActiveKey = sectionKey(nextSection);
                return [...sections, nextSection];
            }
            return (sections || []).map((section) => ({ ...section, children: update(section.children || [], section) }));
        };
        const nextSections = update(data.content.sections || []);
        dispatch({ activeSectionKey: nextActiveKey || data.activeSectionKey, content: { ...(data.content || emptyContent), sections: nextSections } });
    };

    const addChildSection = (targetSection: any) => {
        const targetKey = sectionKey(targetSection);
        let nextActiveKey = "";
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === targetKey) {
                const children = section.children || [];
                const nextSection = makeNewSection(buildNewSectionTitle(children, section));
                nextActiveKey = sectionKey(nextSection);
                return { ...section, children: [...children, nextSection] };
            }
            return { ...section, children: update(section.children || []) };
        });
        const nextSections = update(data.content.sections || []);
        dispatch({ activeSectionKey: nextActiveKey || data.activeSectionKey, content: { ...(data.content || emptyContent), sections: nextSections } });
    };

    const deleteSection = (targetSection: any) => {
        const targetKey = sectionKey(targetSection);
        const update = (sections: any[] = []): any[] => (sections || [])
            .filter((section) => sectionKey(section) !== targetKey)
            .map((section) => ({ ...section, children: update(section.children || []) }));
        const nextSections = update(data.content.sections || []);
        const nextBody = nextSections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
        dispatch({ activeSectionKey: data.activeSectionKey === targetKey ? sectionKey(nextBody[0]) : data.activeSectionKey, content: { ...(data.content || emptyContent), sections: nextSections } });
    };

    const updateSectionTitle = (targetSection: any, title: string) => {
        const targetKey = sectionKey(targetSection);
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => (
            sectionKey(section) === targetKey ? { ...section, title } : { ...section, children: update(section.children || []) }
        ));
        const nextKey = targetSection._key || title || targetSection.ref_type || targetKey;
        dispatch({ activeSectionKey: nextKey, content: { ...(data.content || emptyContent), sections: update(data.content.sections || []) } });
    };

    // ---------------- 矩阵（威胁 / 三类RCM）CRUD ----------------
    const controlApi = {
        internal: { add: Api.add_cybersec_control_internal, update: Api.update_cybersec_control_internal, del: Api.delete_cybersec_control_internal, list: data.controlsInternal },
        sbom: { add: Api.add_cybersec_control_sbom, update: Api.update_cybersec_control_sbom, del: Api.delete_cybersec_control_sbom, list: data.controlsSbom },
        scan: { add: Api.add_cybersec_control_scan, update: Api.update_cybersec_control_scan, del: Api.delete_cybersec_control_scan, list: data.controlsScan },
    } as any;

    const openMatrixEdit = (type: string, row?: any) => {
        matrixForm.resetFields();
        if (row) matrixForm.setFieldsValue(row);
        dispatch({ matrixDlg: type, matrixEditMode: row ? "edit" : "add", matrixTarget: row || {} });
    };

    const saveMatrix = () => {
        matrixForm.validateFields().then((values) => {
            const type = data.matrixDlg;
            const payload: any = { doc_id: docId, product_id: productIdForMatrix, ...data.matrixTarget, ...values };
            let request;
            if (type === "threat") {
                payload.view_type = "STRIDE";
                request = data.matrixEditMode === "edit" ? Api.update_cybersec_threat(payload) : Api.add_cybersec_threat(payload);
            } else {
                const api = controlApi[type];
                request = data.matrixEditMode === "edit" ? api.update(payload) : api.add(payload);
            }
            dispatch({ matrixSaving: true });
            request.then((res: any) => {
                dispatch({ matrixSaving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ matrixDlg: "" });
                    loadMatrixData(docId);
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const deleteMatrixRow = (type: string, row: any) => {
        const del = type === "threat" ? Api.delete_cybersec_threat : controlApi[type].del;
        del({ id: row.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                loadMatrixData(docId);
            } else {
                message.error(res.msg);
            }
        });
    };

    const traceabilityRows = (() => {
        const allControls = [
            ...(data.controlsInternal || []).map((c: any) => ({ ...c, _source: "内部" })),
            ...(data.controlsSbom || []).map((c: any) => ({ ...c, _source: "SBOM" })),
            ...(data.controlsScan || []).map((c: any) => ({ ...c, _source: "扫描" })),
        ];
        const rows: any[] = [];
        (data.threats || []).forEach((threat: any) => {
            const tcode = String(threat.threat_code || "").trim();
            allControls.forEach((ctrl: any) => {
                const linkedByThreat = tcode && String(ctrl.threat_codes || "").includes(tcode);
                const linkedByRcm = String(ctrl.rcm_code || "").trim() && String(threat.rcm_codes || "").includes(String(ctrl.rcm_code).trim());
                if (linkedByThreat || linkedByRcm) {
                    rows.push({ key: `${threat.id}-${ctrl._source}-${ctrl.id}`, threat_code: tcode, description: threat.description, rcm_code: ctrl.rcm_code, ctrl_desc: ctrl.description, source: ctrl._source });
                }
            });
        });
        return rows;
    })();

    // ---------------- 渲染 ----------------
    const matrixTip = (
        <div className="risk-mgmt-section-tip">请先保存报告后再维护威胁与控制措施明细（明细按报告独立持久化）。</div>
    );

    const renderThreatSection = () => {
        if (!docId) {
            return (
                <div className="risk-mgmt-rcm-block">
                    {matrixTip}
                    <div className="risk-mgmt-rcm-title">产品 CST（网络安全威胁库）参考</div>
                    <table className="risk-mgmt-rcm-native-table">
                        <thead><tr><th>编号</th><th>类别</th><th>描述</th><th>关联RCM</th></tr></thead>
                        <tbody>
                            {(data.prodCsts || []).map((row: any) => (
                                <tr key={row.id || row.code}><td>{row.code}</td><td>{row.category}</td><td>{row.description}</td><td>{row.rcm_codes}</td></tr>
                            ))}
                            {!(data.prodCsts || []).length && <tr><td colSpan={4}>当前产品暂无 CST 数据。</td></tr>}
                        </tbody>
                    </table>
                </div>
            );
        }
        const hasThreats = (data.threats || []).length > 0;
        return (
            <div className="risk-mgmt-rcm-block">
                {!isView && <Button size="small" className="risk-mgmt-add-rcm-row" onClick={() => openMatrixEdit("threat")}>新增威胁</Button>}
                {hasThreats && (
                    <table className="risk-mgmt-rcm-native-table">
                        <thead>
                            <tr>
                                <th>威胁编号</th><th>STRIDE类别</th><th>资产/对象</th><th>威胁描述</th><th>可能性</th><th>严重度</th><th>风险水平</th><th>控制措施</th><th>关联RCM</th>{!isView && <th>操作</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {(data.threats || []).map((row: any) => (
                                <tr key={row.id}>
                                    <td>{row.threat_code}</td><td>{row.stride_category}</td><td>{row.asset}</td><td>{row.description}</td>
                                    <td>{row.likelihood}</td><td>{row.severity}</td><td>{row.risk_level}</td><td>{row.control_measures}</td><td>{row.rcm_codes}</td>
                                    {!isView && (
                                        <td>
                                            <Button type="link" size="small" onClick={() => openMatrixEdit("threat", row)}>{ts("edit")}</Button>
                                            <Button type="link" size="small" danger onClick={() => deleteMatrixRow("threat", row)}>{ts("delete")}</Button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        );
    };

    const renderControlSection = (kind: "internal" | "sbom" | "scan") => {
        if (!docId) {
            return (
                <div className="risk-mgmt-rcm-block">
                    {matrixTip}
                    <div className="risk-mgmt-rcm-title">产品 RCM 参考</div>
                    <table className="risk-mgmt-rcm-native-table">
                        <thead><tr><th>控制措施描述</th></tr></thead>
                        <tbody>
                            {(data.prodRcms || []).map((row: any) => (<tr key={row.id || row.rcm_id || row.code}><td>{row.description}</td></tr>))}
                            {!(data.prodRcms || []).length && <tr><td>当前产品暂无 RCM 数据。</td></tr>}
                        </tbody>
                    </table>
                </div>
            );
        }
        const list = controlApi[kind].list || [];
        return (
            <div className="risk-mgmt-rcm-block">
                {!isView && <Button size="small" className="risk-mgmt-add-rcm-row" onClick={() => openMatrixEdit(kind)}>新增RCM</Button>}
                {list.length > 0 && (
                    <table className="risk-mgmt-rcm-native-table">
                        <thead>
                            <tr><th>RCM编号</th><th>控制措施描述</th><th>关联威胁编号</th><th>验证证据</th><th>是否引入新风险</th><th>备注</th>{!isView && <th>操作</th>}</tr>
                        </thead>
                        <tbody>
                            {list.map((row: any) => (
                                <tr key={row.id}>
                                    <td>{row.rcm_code}</td><td>{row.description}</td><td>{row.threat_codes}</td><td>{row.verification_evidence}</td><td>{row.new_risk_flag ? "是" : "否"}</td><td>{row.note}</td>
                                    {!isView && (
                                        <td>
                                            <Button type="link" size="small" onClick={() => openMatrixEdit(kind, row)}>{ts("edit")}</Button>
                                            <Button type="link" size="small" danger onClick={() => deleteMatrixRow(kind, row)}>{ts("delete")}</Button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        );
    };

    const renderTraceabilitySection = () => (
        <div className="risk-mgmt-rcm-block">
            <div className="risk-mgmt-rcm-title">威胁缓解措施追溯（运行时计算，只读）</div>
            <table className="risk-mgmt-rcm-native-table">
                <thead><tr><th>威胁编号</th><th>威胁描述</th><th>关联RCM编号</th><th>控制措施描述</th><th>来源</th></tr></thead>
                <tbody>
                    {traceabilityRows.map((row: any) => (
                        <tr key={row.key}><td>{row.threat_code}</td><td>{row.description}</td><td>{row.rcm_code}</td><td>{row.ctrl_desc}</td><td>{row.source}</td></tr>
                    ))}
                    {!traceabilityRows.length && <tr><td colSpan={5}>暂无可追溯的威胁↔控制措施关联。</td></tr>}
                </tbody>
            </table>
        </div>
    );

    const renderFrontMatterTable = (section: any, tableIndex: number, rows: any[]) => (
        <table className="risk-mgmt-section-table risk-mgmt-front-table" key={`${sectionKey(section)}-${tableIndex}`}>
            <tbody>
                {(rows || []).map((row: any[], rowIndex: number) => (
                    <tr key={`front-row-${rowIndex}`}>
                        {(row || []).map((cell: any, cellIndex: number) => {
                            const isCover = isCoverSection(section);
                            const isLabelCell = isCover && (cellIndex === 0 || cellIndex === 2 || (rowIndex === 4 && cellIndex > 1));
                            const isHeaderCell = !isCover && rowIndex === 0;
                            const readOnlyCell = isView || isLabelCell || isHeaderCell;
                            return (
                                <td key={`front-cell-${cellIndex}`} className={isLabelCell || isHeaderCell ? "front-table-header-cell" : ""}>
                                    {readOnlyCell ? cell : (
                                        <Input.TextArea
                                            autoSize={{ minRows: 1, maxRows: 4 }}
                                            value={cell}
                                            onChange={(e) => updateSectionTableCell(sectionKey(section), tableIndex, rowIndex, cellIndex, e.target.value)}
                                        />
                                    )}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const renderFrontMatterSections = () => {
        const coverSection = frontMatterSections.find((section: any) => isCoverSection(section)) || createCoverSection();
        const revisionSection = frontMatterSections.find((section: any) => isRevisionSection(section)) || createRevisionSection();
        return (
            <Card title="封面与文件修订记录" className="risk-mgmt-front-card">
                <div className="risk-mgmt-front-title">标题</div>
                <div className="risk-mgmt-front-file-name">网络安全风险管理报告</div>
                <div className="risk-mgmt-front-title">封面信息</div>
                {(coverSection.tables || []).map((rows: any[], tableIndex: number) => renderFrontMatterTable(coverSection, tableIndex, rows))}
                <div className="risk-mgmt-front-title">文件修订记录</div>
                {(revisionSection.tables || []).map((rows: any[], tableIndex: number) => renderFrontMatterTable(revisionSection, tableIndex, rows))}
            </Card>
        );
    };

    const renderActiveSectionContent = () => {
        if (!activeSection) return <div className="empty">请选择左侧目录</div>;
        const tables = Array.isArray(activeSection.tables) ? activeSection.tables : [];
        const sectionText = activeSection.text || activeSection.content || "";
        const kind = controlKindOf(activeSection);
        const images: string[] = Array.isArray(activeSection.images) ? activeSection.images : [];
        const cstRcmMap = buildCstRcmMap(data.prodCsts || []);
        const rcmDescMap = buildRcmCodeMap(data.prodRcms || []);
        const renderRawTables = () => tables.map((rows: any[], tableIndex: number) => {
            // 威胁表：RCM 列若产品 CST 有该威胁的 RCM 则取 CST（只读），否则保留 Word 导入值
            const isThreatTbl = tableHasThreatColumn(rows);
            const { codeCol, rcmCol } = isThreatTbl ? findThreatTableCols(rows) : { codeCol: -1, rcmCol: -1 };
            const mergePlan = isThreatTbl ? computeHeaderMergePlan(rows, codeCol) : null;
            return (
            <div key={`table-wrap-${tableIndex}`}>
                <table className="risk-mgmt-section-table">
                    <tbody>
                        {(rows || []).map((row: any[], rowIndex: number) => {
                            const code = codeCol >= 0 ? String(row?.[codeCol] ?? "").trim() : "";
                            const cstRcm = code && cstRcmMap.has(code) ? cstRcmMap.get(code) || "" : null;
                            const isHeaderRow = !!mergePlan && rowIndex < mergePlan.headerRows;
                            return (
                            <tr key={`row-${rowIndex}`}>
                                {(row || []).map((cell: any, cellIndex: number) => {
                                    if (isHeaderRow && mergePlan!.skip[rowIndex]?.[cellIndex]) return null;
                                    const cellSpan = isHeaderRow ? mergePlan!.span[rowIndex]?.[cellIndex] : null;
                                    const useCstRcm = cstRcm !== null && cellIndex === rcmCol;
                                    if (useCstRcm) {
                                        return (
                                            <td key={`cell-${cellIndex}`}>{resolveRcmCodesText(cstRcm, rcmDescMap)}</td>
                                        );
                                    }
                                    return (
                                    <td
                                        key={`cell-${cellIndex}`}
                                        colSpan={cellSpan?.colspan && cellSpan.colspan > 1 ? cellSpan.colspan : undefined}
                                        rowSpan={cellSpan?.rowspan && cellSpan.rowspan > 1 ? cellSpan.rowspan : undefined}
                                    >
                                        {isView ? cell : (
                                            <Input.TextArea
                                                autoSize={{ minRows: 1, maxRows: 8 }}
                                                value={cell}
                                                onChange={(e) => updateSectionTableCell(sectionKey(activeSection), tableIndex, rowIndex, cellIndex, e.target.value)}
                                            />
                                        )}
                                    </td>
                                    );
                                })}
                                {!isView && (
                                    <td style={{ width: 56, textAlign: "center", verticalAlign: "middle" }}>
                                        {rowIndex > 0 && (
                                            <Button
                                                type="link"
                                                danger
                                                size="small"
                                                onClick={() => deleteSectionTableRow(sectionKey(activeSection), tableIndex, rowIndex)}
                                            >删除</Button>
                                        )}
                                    </td>
                                )}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
                {!isView && (
                    <Button
                        size="small"
                        style={{ margin: "8px 0 16px" }}
                        onClick={() => addSectionTableRow(sectionKey(activeSection), tableIndex)}
                    >+ 添加行</Button>
                )}
            </div>
            );
        });
        const hasRawTables = tables.length > 0;
        const matrixRowCount = isStrideSection(activeSection) ? (data.threats || []).length
            : kind ? ((controlApi[kind]?.list) || []).length
                : isTraceabilitySection(activeSection) ? traceabilityRows.length : 0;
        // 有导入原始表且矩阵为空时，隐藏空矩阵（避免冗余）；矩阵有数据或无导入表时仍展示
        const showMatrix = matrixRowCount > 0 || !hasRawTables;
        const importedTablesBlock = hasRawTables
            ? (showMatrix
                ? (<div className="cybersec-imported-tables"><div className="risk-mgmt-rcm-title">导入的原始表</div>{renderRawTables()}</div>)
                : renderRawTables())
            : null;
        return (
            <div className="risk-mgmt-section-content">
                {isView ? (sectionText ? <div className="risk-mgmt-section-text">{sectionText}</div> : null) : (
                    <Input.TextArea
                        value={sectionText}
                        onChange={(e) => updateSectionText(sectionKey(activeSection), e.target.value)}
                        autoSize={{ minRows: 5, maxRows: 18 }}
                        placeholder="请输入章节内容"
                    />
                )}
                {isFlowDiagramSection(activeSection) ? (
                    <div className="cybersec-section-images">
                        {data.flowImageUrl ? (
                            <img
                                src={data.flowImageUrl}
                                alt="网络安全流程图"
                                style={{ maxWidth: "100%", height: "auto", display: "block", margin: "8px 0" }}
                            />
                        ) : (
                            <div className="empty">未获取到网络安全流程图，请先在「图表文件管理 → 网络安全流程图」上传该产品的流程图。</div>
                        )}
                    </div>
                ) : (
                    <div className="cybersec-section-images">
                        {images.map((url: string, imgIndex: number) => (
                            <div key={`img-${imgIndex}`} style={{ margin: "8px 0" }}>
                                <img
                                    src={url}
                                    alt={`${activeSection.title || "章节"}-图${imgIndex + 1}`}
                                    style={{ maxWidth: "100%", height: "auto", display: "block" }}
                                />
                                {!isView && (
                                    <Space style={{ marginTop: 4 }}>
                                        <Upload
                                            accept="image/*"
                                            showUploadList={false}
                                            beforeUpload={(file) => uploadSectionImage(activeSection, file as File, imgIndex)}
                                        >
                                            <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                        </Upload>
                                        <Button size="small" danger onClick={() => deleteSectionImage(activeSection, imgIndex)}>删除</Button>
                                    </Space>
                                )}
                            </div>
                        ))}
                        {!isView && (
                            <Upload
                                accept="image/*"
                                showUploadList={false}
                                beforeUpload={(file) => uploadSectionImage(activeSection, file as File)}
                            >
                                <Button size="small" icon={<UploadOutlined />} style={{ margin: "8px 0" }}>上传图片</Button>
                            </Upload>
                        )}
                    </div>
                )}
                {isStrideSection(activeSection) ? (<>{showMatrix && renderThreatSection()}{importedTablesBlock}</>)
                    : kind ? (<>{showMatrix && renderControlSection(kind)}{importedTablesBlock}</>)
                        : isTraceabilitySection(activeSection) ? (<>{showMatrix && renderTraceabilitySection()}{importedTablesBlock}</>)
                            : renderRawTables()}
            </div>
        );
    };

    const matrixDlgTitleMap: Record<string, string> = {
        threat: "STRIDE 威胁", internal: "内部 RCM", sbom: "SBOM RCM", scan: "网络安全扫描 RCM",
    };

    return (
        <div className="risk-mgmt-detail div-v">
            <div className="risk-mgmt-detail-toolbar div-h center-v">
                <Button onClick={() => navigate("/cybersec_docs")}>{ts("back")}</Button>
                <div className="expand" />
                {!isView && (
                    <Space>
                        <Button onClick={initTemplate}>初始化模版</Button>
                        <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>
                    </Space>
                )}
                {!isAdd && <Button loading={data.exporting} onClick={doExport}>导出</Button>}
            </div>
            <Form
                form={form}
                layout="vertical"
                disabled={isView}
                onValuesChange={(changed) => {
                    if (Object.prototype.hasOwnProperty.call(changed, "version")) {
                        dispatch({ content: syncFileVersionInCover(data.content || emptyContent, changed.version) });
                    }
                }}>
                <Card title="基础信息" loading={data.loading}>
                    <div className="risk-mgmt-basic-grid">
                        {isAdd ? (
                            <Form.Item
                                label={ts("product.product")}
                                name="product_id"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                                <ProductVersionSelect
                                    products={data.products}
                                    value={data.selectedProductId}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        form.setFieldValue("product_id", value);
                                        dispatch({ selectedProductId: value });
                                        const selectedProduct = (data.products || []).find((p: any) => p.id === value);
                                        let content = syncProductNameInContent(data.content || emptyContent, selectedProduct?.name || "");
                                        content = fillProductTextSections(content, selectedProduct);
                                        dispatch({ content });
                                    }}
                                />
                            </Form.Item>
                        ) : (
                            <>
                                <Form.Item label={ts("product.name")} name="product_name"><Input disabled /></Form.Item>
                                <Form.Item label={ts("product.type_code")} name="product_type_code"><Input disabled /></Form.Item>
                                <Form.Item label={ts("product.full_version")} name="product_full_version"><Input disabled /></Form.Item>
                            </>
                        )}
                        <Form.Item label="报告版本" name="version" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "报告版本" }) }]}>
                            <Input />
                        </Form.Item>
                    </div>
                    <Form.Item label="变更说明" name="change_log"><Input.TextArea autoSize /></Form.Item>
                </Card>
            </Form>
            {renderFrontMatterSections()}
            <div className="risk-mgmt-body">
                <Card title="目录结构">
                    <div className="risk-mgmt-section-list">
                        {!isView && <Button className="risk-mgmt-add-root-section" onClick={addRootSection}>新增一级目录</Button>}
                        {bodySections.length ? (
                            <SectionList
                                sections={bodySections}
                                activeKey={data.activeSectionKey}
                                onSelect={selectSection}
                                onTitleChange={updateSectionTitle}
                                onAddSibling={addSiblingSection}
                                onAddChild={addChildSection}
                                onDelete={deleteSection}
                                readOnly={isView}
                            />
                        ) : <div className="empty">暂无目录结构，请点击初始化模版</div>}
                    </div>
                </Card>
                <div ref={contentCardRef}>
                    <Card title={activeSection?.title || "章节内容"}>
                        {renderActiveSectionContent()}
                    </Card>
                </div>
            </div>
            <Modal
                width={data.matrixDlg === "threat" ? "70%" : "56%"}
                centered
                title={`${data.matrixEditMode === "edit" ? ts("edit") : ts("add")}${matrixDlgTitleMap[data.matrixDlg] || ""}`}
                open={!!data.matrixDlg}
                confirmLoading={data.matrixSaving}
                onOk={saveMatrix}
                onCancel={() => dispatch({ matrixDlg: "" })}>
                <Form form={matrixForm} layout="vertical">
                    {data.matrixDlg === "threat" ? (
                        <div className="risk-mgmt-basic-grid">
                            <Form.Item name="threat_code" label="威胁编号" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "威胁编号" }) }]}><Input /></Form.Item>
                            <Form.Item name="stride_category" label="STRIDE类别"><Input /></Form.Item>
                            <Form.Item name="asset" label="资产/对象"><Input /></Form.Item>
                            <Form.Item name="description" label="威胁描述"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                            <Form.Item name="attack_path" label="攻击路径"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                            <Form.Item name="impact" label="影响"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                            <Form.Item name="likelihood" label="可能性"><Select allowClear options={likelihoodOptions} /></Form.Item>
                            <Form.Item name="severity" label="严重度"><Select allowClear options={severityOptions} /></Form.Item>
                            <Form.Item name="risk_level" label="风险水平"><Select allowClear options={riskLevelOptions} /></Form.Item>
                            <Form.Item name="control_measures" label="控制措施"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                            <Form.Item name="rcm_codes" label="关联RCM编号串"><Input /></Form.Item>
                            <Form.Item name="residual_likelihood" label="剩余可能性"><Select allowClear options={likelihoodOptions} /></Form.Item>
                            <Form.Item name="residual_severity" label="剩余严重度"><Select allowClear options={severityOptions} /></Form.Item>
                            <Form.Item name="residual_level" label="剩余风险水平"><Select allowClear options={riskLevelOptions} /></Form.Item>
                        </div>
                    ) : (
                        <div className="risk-mgmt-basic-grid">
                            <Form.Item name="rcm_code" label="RCM编号" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "RCM编号" }) }]}><Input /></Form.Item>
                            <Form.Item name="threat_codes" label="关联威胁编号串"><Input /></Form.Item>
                            <Form.Item name="description" label="控制措施描述"><Input.TextArea autoSize={{ minRows: 1, maxRows: 6 }} /></Form.Item>
                            <Form.Item name="verification_evidence" label="验证证据"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                            <Form.Item name="new_risk_flag" label="是否引入新风险"><Select allowClear options={yesNoOptions} /></Form.Item>
                            <Form.Item name="note" label="备注"><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
                        </div>
                    )}
                </Form>
            </Modal>
        </div>
    );
};
