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
import * as ApiSrsDoc from "@/api/ApiSrsDoc";
import "../risk_mgmt/RiskMgmtDocDetail.less";
// 新增页默认内容：与后端 src-res/cybersec_default_content.json 同源（自动获取章节为模板态，其余为编辑页默认正文/表格/图片）
import cybersecDefaultContent from "./cybersecDefaultContent.json";

const emptyContent = { sections: [], productName: "" };

// 网络安全扫描类威胁编号固定名单（手动维护）：5.2.3 只显示名单内 THREAT，5.2.1 显示名单外 THREAT
const CYBERSEC_SCAN_THREAT_CODES = ["THREAT-040"];

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
        ["", "", "", "", ""],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
    ]],
});

const templateContent: any = cybersecDefaultContent;

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
// 反推 RCM 编号 -> 关联的威胁编号（来自产品 CST 的 rcm_codes）
const buildRcmThreatMap = (prodCsts: any[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    (prodCsts || []).forEach((row: any) => {
        const threat = String(row?.code || "").trim();
        if (!threat) return;
        const codes = String(row?.rcm_codes || "").match(RCM_CODE_RE) || [];
        codes.forEach((rcm: string) => {
            const arr = map.get(rcm) || [];
            if (!arr.includes(threat)) arr.push(threat);
            map.set(rcm, arr);
        });
    });
    return map;
};
// trace 行的 rcm_codes（数组或串）归一化为 RCM 编号数组
const normalizeRcmCodeList = (val: any): string[] => {
    if (Array.isArray(val)) return val.flatMap((v) => String(v).match(RCM_CODE_RE) || []);
    return String(val ?? "").match(RCM_CODE_RE) || [];
};
// 测试用例数组（[首, 末]）拼成展示串
// 用例编号逐个独占一行，且编号本身不被逐字折断（区间以 "~" 分隔）
const renderTestCodes = (val: any) => {
    const arr = Array.isArray(val)
        ? val.filter((v) => v != null && String(v) !== "").map((v) => String(v))
        : String(val ?? "").split(/[,，\s]+/).filter(Boolean);
    if (!arr.length) return "";
    return arr.map((c: string, i: number) => (
        <div key={i} className="cybersec-code-nowrap">{i > 0 ? "~ " : ""}{c}</div>
    ));
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
// 定位威胁表「缓解前/缓解后」4 子列 → prod_cst 评分字段（map1：CVSS=score,可利用性=severity,严重度=level,接受度=accept）
const findScoreColMap = (rows: any[]): Record<number, string> => {
    const header = (rows && rows[0]) || [];
    const map: Record<number, string> = {};
    let pre = -1;
    let post = -1;
    header.forEach((cell: any, idx: number) => {
        const t = normalizeTitleText(cell);
        if (pre < 0 && t.includes("缓解前")) pre = idx;
        if (post < 0 && t.includes("缓解后")) post = idx;
    });
    if (pre >= 0) {
        map[pre] = "prev_score"; map[pre + 1] = "prev_severity"; map[pre + 2] = "prev_level"; map[pre + 3] = "prev_accept";
    }
    if (post >= 0) {
        map[post] = "cur_score"; map[post + 1] = "cur_severity"; map[post + 2] = "cur_level"; map[post + 3] = "cur_accept";
    }
    return map;
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
// 追溯表默认表头（与 Word《威胁缓解措施追溯》一致），导入表无表头时兜底
const TRACE_HEADER_ROWS: string[][] = [
    ["软件需求规格", "是否为RCM", "威胁编号", "软件详细设计", "单元测试用例", "集成测试用例", "系统测试用例", "用户测试用例", "风险控制措施RCMID", "备注"],
    ["《需求规格说明》", "是否为RCM", "威胁编号", "《软件详细设计》", "《单元测试记录》", "《集成测试记录》", "《系统测试记录》", "《用户测试记录》", "《风险管理报告》（RCMID）", "如果SRS不作为风险控制措施，RCMID将以“/”表示。"],
    ["《需求规格说明》", "是否为RCM", "威胁编号", "（源代码名称）", "《软件测试报告》", "《软件测试报告》", "《软件测试报告》", "《用户测试报告》", "《风险管理报告》（RCMID）", "如果SRS不作为风险控制措施，RCMID将以“/”表示。"],
];
// 表头合并（全部行均为表头）：横向连续空串→colspan，上下同文本→rowspan
const computeAllHeaderMerge = (hrows: any[][]) => {
    const width = hrows.reduce((m: number, r: any[]) => Math.max(m, (r || []).length), 0);
    const n = hrows.length;
    const skip: boolean[][] = hrows.map(() => new Array(width).fill(false));
    const span: ({ colspan: number; rowspan: number } | null)[][] = hrows.map(() => new Array(width).fill(null));
    const txt = (r: number, c: number) => String(hrows[r]?.[c] ?? "");
    for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < width; c += 1) {
            if (skip[r][c]) continue;
            let colspan = 1;
            while (c + colspan < width && txt(r, c + colspan) === "") { skip[r][c + colspan] = true; colspan += 1; }
            let rowspan = 1;
            if (txt(r, c) !== "") {
                while (r + rowspan < n && txt(r + rowspan, c) === txt(r, c)) {
                    for (let cc = c; cc < c + colspan; cc += 1) skip[r + rowspan][cc] = true;
                    rowspan += 1;
                }
            }
            span[r][c] = { colspan, rowspan };
        }
    }
    return { width, skip, span };
};
// 风险评估评分矩阵表识别：仅该表做整表合并（空串→colspan、上下同文本→rowspan），避免误伤其他可编辑空表
const tableIsScoreMatrix = (rows: any[]): boolean => {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    let hasRiskVal = false;
    let hasSeverity = false;
    for (const r of rows) {
        for (const c of r || []) {
            const v = String(c ?? "").trim();
            if (v === "风险值") hasRiskVal = true;
            if (v === "严重度") hasSeverity = true;
        }
    }
    return hasRiskVal && hasSeverity;
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
            // 适用范围/产品描述为自动获取项，始终以产品数据为准覆盖（即使为空也补位/清空）
            if (key === "适用范围") {
                section.text = product?.scope || "";
            } else if (key === "产品描述") {
                section.text = buildProductDescription(product);
            } else if (!hasText && defaultMap[key] !== undefined) {
                section.text = defaultMap[key];
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
        traceRows: [],
    });

    const loadProducts = () => {
        if ((data.products || []).length > 0) return;
        ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    const loadReferenceData = (productId?: any) => {
        if (!productId) {
            dispatch({ prodCsts: [], prodRcms: [], prodHazs: [], traceRows: [] });
            return;
        }
        // 7 威胁缓解措施追溯：复用「追溯分析」的 SRS 追溯数据（RCM→SRS/测试用例）
        ApiSrsDoc.list_srs_doc({ product_id: productId, page_index: 0, page_size: 50 }).then((res: any) => {
            if (res.code !== ApiSrsDoc.C_OK) { dispatch({ traceRows: [] }); return; }
            const docs = res.data?.rows || [];
            if (!docs.length) { dispatch({ traceRows: [] }); return; }
            const srsDocId = docs[0].id; // 取该产品最新一份 SRS 文档
            ApiSrsDoc.list_doc_trace({ id: srsDocId }).then((r2: any) => {
                dispatch({ traceRows: (r2.code === ApiSrsDoc.C_OK ? (r2.data || []) : []) });
            });
        });
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
        // 初始化只重置静态模版（文字/表格/blocks）；动态自动内容（STRIDE、5.2.x、追溯、流程图）重新拉取，避免“都没了”
        loadReferenceData(currentProductId);
        loadMatrixData(data.detail?.id);
        message.success("初始化模版成功，已重新获取自动内容");
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

    // 有序内容块（text/table 交错）编辑
    const cloneBlocks = (section: any) => (
        Array.isArray(section.blocks)
            ? section.blocks.map((b: any) => (
                b?.type === "table"
                    ? { ...b, table: (b.table || []).map((row: any[]) => [...(row || [])]) }
                    : { ...b }
            ))
            : []
    );
    const updateBlockText = (key: string, blockIndex: number, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const blocks = cloneBlocks(section);
                if (blocks[blockIndex]) blocks[blockIndex] = { ...blocks[blockIndex], text: value };
                return { ...section, blocks };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };
    const updateBlockTableCell = (key: string, blockIndex: number, rowIndex: number, cellIndex: number, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const blocks = cloneBlocks(section);
                const block = blocks[blockIndex];
                if (block && block.type === "table") {
                    if (!block.table[rowIndex]) block.table[rowIndex] = [];
                    block.table[rowIndex][cellIndex] = value;
                }
                return { ...section, blocks };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };
    const addBlockTableRow = (key: string, blockIndex: number) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const blocks = cloneBlocks(section);
                const block = blocks[blockIndex];
                if (block && block.type === "table") {
                    const colCount = Math.max(1, ...(block.table || []).map((row: any[]) => (row || []).length));
                    block.table.push(new Array(colCount).fill(""));
                }
                return { ...section, blocks };
            }
            return { ...section, children: update(section.children || []) };
        });
        updateSections(update);
    };
    const deleteBlockTableRow = (key: string, blockIndex: number, rowIndex: number) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const blocks = cloneBlocks(section);
                const block = blocks[blockIndex];
                if (block && block.type === "table") block.table.splice(rowIndex, 1);
                return { ...section, blocks };
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
    const matrixTip = null;

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
        // 5.2.2 SBOM：新增页不自动获取，保持默认模版；已有文档仍可手动维护 RCM
        if (kind === "sbom") {
            if (!docId) {
                return (
                    <div className="risk-mgmt-rcm-block">
                        {matrixTip}
                        <div className="risk-mgmt-rcm-title">SBOM 风险评估及控制措施（默认模版，不自动获取）</div>
                    </div>
                );
            }
        } else {
            // 5.2.1 内部 / 5.2.3 网络安全扫描：新增页与编辑页均展示产品 THREAT 参考表（名单外/名单内）
            const scanSet = new Set(CYBERSEC_SCAN_THREAT_CODES);
            const csts = (data.prodCsts || []).filter((row: any) => {
                const isScan = scanSet.has(String(row?.code || "").trim());
                return kind === "scan" ? isScan : !isScan;
            });
            const refRcmDescMap = buildRcmCodeMap(data.prodRcms || []);
            return (
                <div className="risk-mgmt-rcm-block">
                    {matrixTip}
                    <div className="risk-mgmt-rcm-title">{kind === "scan" ? "网络安全扫描 THREAT 参考" : "内部 THREAT 参考"}</div>
                    <div className="cybersec-section-table-wrap">
                        <table className="risk-mgmt-section-table cybersec-section-table">
                            <tbody>
                                <tr>
                                    <td className="cybersec-table-th" rowSpan={2}>威胁编号</td>
                                    <td className="cybersec-table-th" rowSpan={2}>分类</td>
                                    <td className="cybersec-table-th" rowSpan={2}>威胁描述</td>
                                    <td className="cybersec-table-th" colSpan={4}>缓解前</td>
                                    <td className="cybersec-table-th" colSpan={4}>缓解后</td>
                                    <td className="cybersec-table-th" rowSpan={2}>缓解措施(RCM)</td>
                                </tr>
                                <tr>
                                    <td className="cybersec-table-th">CVSS分值</td>
                                    <td className="cybersec-table-th">可利用性分值</td>
                                    <td className="cybersec-table-th">严重度</td>
                                    <td className="cybersec-table-th">接受度</td>
                                    <td className="cybersec-table-th">CVSS分值</td>
                                    <td className="cybersec-table-th">可利用性分值</td>
                                    <td className="cybersec-table-th">严重度</td>
                                    <td className="cybersec-table-th">接受度</td>
                                </tr>
                                {csts.map((row: any) => (
                                    <tr key={row.id || row.cst_id || row.code}>
                                        <td>{row.code}</td>
                                        <td>{row.category}</td>
                                        <td>{row.description}</td>
                                        <td>{row.prev_score ?? ""}</td>
                                        <td>{row.prev_severity ?? ""}</td>
                                        <td>{row.prev_level ?? ""}</td>
                                        <td>{row.prev_accept ?? ""}</td>
                                        <td>{row.cur_score ?? ""}</td>
                                        <td>{row.cur_severity ?? ""}</td>
                                        <td>{row.cur_level ?? ""}</td>
                                        <td>{row.cur_accept ?? ""}</td>
                                        <td>{resolveRcmCodesText(row.rcm_codes, refRcmDescMap)}</td>
                                    </tr>
                                ))}
                                {!csts.length && <tr><td colSpan={12}>当前产品暂无对应 THREAT 数据。</td></tr>}
                            </tbody>
                        </table>
                    </div>
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

    const renderTraceabilitySection = () => {
        const rcmThreatMap = buildRcmThreatMap(data.prodCsts || []);
        const rows = data.traceRows || [];
        // 表头沿用 Word 导入原表的前导表头行（数据行 col0 形如 SRS-xxx），无则用默认模板
        const importedTable: any[] = (Array.isArray(activeSection?.tables) && activeSection.tables[0]) || [];
        let headerCount = 0;
        for (let r = 0; r < importedTable.length; r += 1) {
            const c0 = String(importedTable[r]?.[0] ?? "").trim();
            if (/^SRS[-_]/i.test(c0)) break;
            headerCount += 1;
        }
        const headerRows: any[][] = headerCount > 0 ? importedTable.slice(0, headerCount) : TRACE_HEADER_ROWS;
        const merge = computeAllHeaderMerge(headerRows);
        const colCount = merge.width || 10;
        // 仅保留「威胁编号↔RCM」有对应关系的行：既有 RCM 编号、又能反推出威胁编号（只有 RCM 号但无对应威胁的不纳入）
        const bodyRows = rows
            .map((row: any) => {
                const numOf = (code: string) => { const m = String(code).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; };
                const byNum = (a: string, b: string) => numOf(a) - numOf(b) || String(a).localeCompare(String(b));
                const rcmList = Array.from(new Set(normalizeRcmCodeList(row.rcm_codes))).sort(byNum);
                const threats = Array.from(new Set(rcmList.flatMap((c) => rcmThreatMap.get(c) || []))).sort(byNum);
                return { row, rcmList, threats };
            })
            .filter((x: any) => x.rcmList.length > 0 && x.threats.length > 0)
            // 严格按 Word 列序 [需求, 是否RCM, 威胁编号, SDS, 单元, 集成, 系统, 用户, RCMID, 备注]
            .map(({ row, rcmList, threats }: any) => [
                row.srs_code || "",
                "是",
                threats.map((c: string, i: number) => <div key={i} className="cybersec-code-nowrap">{c}</div>),
                String(row.sds_code || "").split(/[,，\s]+/).filter(Boolean).map((c: string, i: number) => <div key={i} className="cybersec-code-nowrap">{c}</div>),
                renderTestCodes(row.tests_unit),
                renderTestCodes(row.tests_integ),
                renderTestCodes(row.tests_sys),
                renderTestCodes(row.tests_user),
                rcmList.map((c: string, i: number) => <div key={i} className="cybersec-code-nowrap">{c}</div>),
                row.note || "",
            ]);
        return (
        <div className="risk-mgmt-rcm-block">
            <div className="risk-mgmt-rcm-title">威胁缓解措施追溯（自动追溯：RCM→SRS/测试用例、RCM→威胁编号，只读）</div>
            <div className="cybersec-section-table-wrap">
                <table className="risk-mgmt-section-table cybersec-section-table">
                    <tbody>
                        {headerRows.map((hrow: any[], r: number) => (
                            <tr key={`thead-${r}`}>
                                {hrow.map((cell: any, c: number) => {
                                    if (merge.skip[r]?.[c]) return null;
                                    const sp = merge.span[r]?.[c];
                                    return (
                                        <td key={`th-${r}-${c}`} className="cybersec-table-th" colSpan={sp?.colspan} rowSpan={sp?.rowspan}>{cell}</td>
                                    );
                                })}
                            </tr>
                        ))}
                        {bodyRows.map((brow: any[], idx: number) => (
                            <tr key={`trace-${idx}`}>
                                {brow.map((cell: any, c: number) => {
                                    const isEmpty = Array.isArray(cell) ? cell.length === 0 : (cell === null || cell === undefined || String(cell) === "");
                                    return (<td key={`td-${idx}-${c}`}>{isEmpty ? "/" : cell}</td>);
                                })}
                            </tr>
                        ))}
                        {!bodyRows.length && <tr><td colSpan={colCount}>未获取到该产品 SRS 追溯数据（请确认已建立对应 SRS 文档）。</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
        );
    };

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
        // 按威胁编号索引产品 CST 行（评分列实时取该行 prev_*/cur_*）
        const cstByCode = new Map<string, any>();
        (data.prodCsts || []).forEach((row: any) => {
            const c = String(row?.code || "").trim();
            if (c) cstByCode.set(c, row);
        });
        const renderOneTable = (
            rows: any[],
            tableKey: string,
            handlers: {
                onCell: (rowIndex: number, cellIndex: number, value: string) => void;
                onDelRow: (rowIndex: number) => void;
                onAddRow: () => void;
            },
        ) => {
            // 威胁表：RCM 列若产品 CST 有该威胁的 RCM 则取 CST（只读），否则保留 Word 导入值
            const isThreatTbl = tableHasThreatColumn(rows);
            const { codeCol, rcmCol } = isThreatTbl ? findThreatTableCols(rows) : { codeCol: -1, rcmCol: -1 };
            const scoreColMap = isThreatTbl ? findScoreColMap(rows) : {};
            const mergePlan = isThreatTbl ? computeHeaderMergePlan(rows, codeCol) : null;
            // 风险评估评分矩阵：整表合并（空串→colspan、同列上下同文本→rowspan）
            const scoreMerge = !isThreatTbl && tableIsScoreMatrix(rows) ? computeAllHeaderMerge(rows) : null;
            return (
            <div key={`table-wrap-${tableKey}`}>
                <div className="cybersec-section-table-wrap">
                <table className="risk-mgmt-section-table cybersec-section-table">
                    <tbody>
                        {(rows || []).map((row: any[], rowIndex: number) => {
                            const code = codeCol >= 0 ? String(row?.[codeCol] ?? "").trim() : "";
                            const cstRcm = code && cstRcmMap.has(code) ? cstRcmMap.get(code) || "" : null;
                            const cstRow = code && cstByCode.has(code) ? cstByCode.get(code) : null;
                            const isHeaderRow = !!mergePlan && rowIndex < mergePlan.headerRows;
                            return (
                            <tr key={`row-${rowIndex}`}>
                                {(row || []).map((cell: any, cellIndex: number) => {
                                    if (isHeaderRow && mergePlan!.skip[rowIndex]?.[cellIndex]) return null;
                                    if (scoreMerge && scoreMerge.skip[rowIndex]?.[cellIndex]) return null;
                                    const cellSpan = isHeaderRow
                                        ? mergePlan!.span[rowIndex]?.[cellIndex]
                                        : (scoreMerge ? scoreMerge.span[rowIndex]?.[cellIndex] : null);
                                    const useCstRcm = cstRcm !== null && cellIndex === rcmCol;
                                    if (useCstRcm) {
                                        return (
                                            <td key={`cell-${cellIndex}`}>{resolveRcmCodesText(cstRcm, rcmDescMap)}</td>
                                        );
                                    }
                                    // 评分列：产品 CST 该威胁有值则实时取（只读），否则保留 Word 导入值
                                    const scoreField = (scoreColMap as Record<number, string>)[cellIndex];
                                    if (scoreField && cstRow && !isHeaderRow) {
                                        const v = cstRow[scoreField];
                                        if (v !== null && v !== undefined && String(v) !== "") {
                                            return <td key={`cell-${cellIndex}`}>{String(v)}</td>;
                                        }
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
                                                onChange={(e) => handlers.onCell(rowIndex, cellIndex, e.target.value)}
                                            />
                                        )}
                                    </td>
                                    );
                                })}
                                {!isView && (
                                    <td style={{ width: 56, textAlign: "center", verticalAlign: "middle" }}>
                                        {rowIndex === 0 ? (
                                            "操作"
                                        ) : (
                                            <Button
                                                type="link"
                                                danger
                                                size="small"
                                                onClick={() => handlers.onDelRow(rowIndex)}
                                            >删除</Button>
                                        )}
                                    </td>
                                )}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
                </div>
                {!isView && (
                    <Button
                        size="small"
                        style={{ margin: "8px 0 16px" }}
                        onClick={() => handlers.onAddRow()}
                    >+ 添加行</Button>
                )}
            </div>
            );
        };
        const renderRawTables = () => tables.map((rows: any[], tableIndex: number) => renderOneTable(
            rows,
            `t${tableIndex}`,
            {
                onCell: (r, c, v) => updateSectionTableCell(sectionKey(activeSection), tableIndex, r, c, v),
                onDelRow: (r) => deleteSectionTableRow(sectionKey(activeSection), tableIndex, r),
                onAddRow: () => addSectionTableRow(sectionKey(activeSection), tableIndex),
            },
        ));
        const blocks: any[] = Array.isArray(activeSection.blocks) ? activeSection.blocks : [];
        const hasBlocks = blocks.length > 0;
        const renderBlocks = () => blocks.map((block: any, blockIndex: number) => {
            if (block?.type === "table") {
                const rows = Array.isArray(block.table) ? block.table : [];
                return renderOneTable(rows, `b${blockIndex}`, {
                    onCell: (r, c, v) => updateBlockTableCell(sectionKey(activeSection), blockIndex, r, c, v),
                    onDelRow: (r) => deleteBlockTableRow(sectionKey(activeSection), blockIndex, r),
                    onAddRow: () => addBlockTableRow(sectionKey(activeSection), blockIndex),
                });
            }
            const textVal = block?.text || "";
            return (
                <div key={`block-${blockIndex}`} style={{ margin: "8px 0" }}>
                    {isView ? (textVal ? <div className="risk-mgmt-section-text">{textVal}</div> : null) : (
                        <Input.TextArea
                            value={textVal}
                            onChange={(e) => updateBlockText(sectionKey(activeSection), blockIndex, e.target.value)}
                            autoSize={{ minRows: 3, maxRows: 18 }}
                            placeholder="请输入内容"
                        />
                    )}
                </div>
            );
        });
        const hasRawTables = tables.length > 0;
        const controlThreatCount = (k: "internal" | "scan") => {
            const scanSet = new Set(CYBERSEC_SCAN_THREAT_CODES);
            return (data.prodCsts || []).filter((r: any) => {
                const isScan = scanSet.has(String(r?.code || "").trim());
                return k === "scan" ? isScan : !isScan;
            }).length;
        };
        const matrixRowCount = isStrideSection(activeSection) ? (data.threats || []).length
            : (kind === "internal" || kind === "scan") ? controlThreatCount(kind)
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
                {!hasBlocks && (isView ? (sectionText ? <div className="risk-mgmt-section-text">{sectionText}</div> : null) : (
                    <Input.TextArea
                        value={sectionText}
                        onChange={(e) => updateSectionText(sectionKey(activeSection), e.target.value)}
                        autoSize={{ minRows: 5, maxRows: 18 }}
                        placeholder="请输入章节内容"
                    />
                ))}
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
                {/* 自动获取章节（STRIDE、内部/网络安全扫描）只展示最新自动表，不再显示导入的原始表（旧数据残留） */}
                {isStrideSection(activeSection) ? (<>{showMatrix && renderThreatSection()}</>)
                    : kind ? (<>{showMatrix && renderControlSection(kind)}{kind === "sbom" ? importedTablesBlock : null}</>)
                        : isTraceabilitySection(activeSection) ? renderTraceabilitySection()
                            : hasBlocks ? renderBlocks()
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
                        <Form.Item
                            label={ts("product.product")}
                            name="product_id"
                            rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                            <ProductVersionSelect
                                products={data.products}
                                value={isAdd ? data.selectedProductId : data.detail?.product_id}
                                namePlaceholder={ts("product.name")}
                                versionPlaceholder={ts("product.full_version")}
                                onChange={(value) => {
                                    form.setFieldValue("product_id", value);
                                    const selectedProduct = (data.products || []).find((p: any) => p.id === value);
                                    dispatch({ selectedProductId: value });
                                    if (!isAdd) {
                                        dispatch({
                                            detail: {
                                                ...data.detail,
                                                product_id: value,
                                                product_name: selectedProduct?.name || "",
                                                product_type_code: selectedProduct?.type_code || "",
                                                product_full_version: selectedProduct?.full_version || "",
                                            },
                                        });
                                    }
                                    let content = syncProductNameInContent(data.content || emptyContent, selectedProduct?.name || "");
                                    content = fillProductTextSections(content, selectedProduct);
                                    dispatch({ content });
                                }}
                            />
                        </Form.Item>
                        <Form.Item label="文档版本" name="version" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "文档版本" }) }]}>
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
