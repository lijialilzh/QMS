import { Button, Form, Input, Space, Spin, Upload, message } from "antd";
import { UploadOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sprintf } from "sprintf-js";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewTable from "@/common/ReviewTable";
import * as Api from "@/api/ApiRiskMgmtDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiProdRcm from "@/api/ApiProdRcm";
import * as ApiHaz from "@/api/ApiHaz";
import * as ApiProdHaz from "@/api/ApiProdHaz";
import { HAZDICT_DEGREES, HAZDICT_LEVELS, HAZDICT_RATES } from "@/pages/basedata/Hazs";
import "../pdp/PdpDocDetail.less";
import "./RiskMgmtDocDetail.less";

const emptyContent = {
    sections: [],
    participants: [],
    riskMatrix: [],
    riskControls: [],
    productName: "",
};

const createCoverSection = () => ({
    title: "风险管理报告",
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

const createAcceptanceStandardSection = () => ({
    title: "5.2.3 接受标准",
    ref_type: "acceptance_standard",
    children: [],
});

const templateContent = {
    sections: [
        createCoverSection(),
        createRevisionSection(),
        { title: "1 目的", children: [] },
        { title: "2 范围", children: [] },
        {
            title: "3 产品描述",
            children: [
                { title: "3.1 产品预期用途", children: [] },
                {
                    title: "3.2 产品功能描述",
                    children: [
                        { title: "3.2.1 产品功能明细", ref_type: "prod_func_detail", children: [] },
                    ],
                },
            ],
        },
        {
            title: "4 评审",
            children: [
                { title: "4.1 评审数据", children: [] },
                { title: "4.2 风险分析参与人员", ref_type: "participants", children: [] },
                { title: "4.3 审评历史", children: [] },
            ],
        },
        {
            title: "5 风险分析方式",
            children: [
                {
                    title: "5.1 危害识别",
                    children: [
                        { title: "5.1.1 与合理可预见相关的环境相关的危害", children: [] },
                        { title: "5.1.2 考虑的危害包括", children: [] },
                        { title: "5.1.3 危害初步原因的考虑应包括", children: [] },
                        { title: "5.1.4 危害重点考虑的原因应包括", children: [] },
                    ],
                },
                {
                    title: "5.2 风险评价准则",
                    children: [
                        { title: "5.2.1 严重度定义", children: [] },
                        { title: "5.2.2 发生概率定义", children: [] },
                        createAcceptanceStandardSection(),
                    ],
                },
            ],
        },
        {
            title: "6 风险分析",
            children: [
                { title: "6.1 与安全有关特征的问题识别", children: [] },
                { title: "6.2 已知或可预见的危险（源）识别", children: [] },
                { title: "6.3 估计每个危险情况的风险", children: [] },
                { title: "6.4 风险评价", ref_type: "risk_analysis", children: [] },
                {
                    title: "6.5 风险控制",
                    ref_type: "risk_controls",
                    children: [
                        { title: "6.5.1 风险控制方案分析", children: [] },
                        { title: "6.5.2 风险控制措施的实施", children: [] },
                        { title: "6.5.3 剩余风险分析和风险/受益分析", children: [] },
                        {
                            title: "6.5.4 由风险控制措施产生的风险",
                            children: [],
                            tables: [[
                                ["RCM编号", "引入的危害", "RCM引入的风险分析", "风险控制措施"],
                            ]],
                        },
                    ],
                },
            ],
        },
        {
            title: "7 风险的可接受性评价",
            children: [
                { title: "7.1 RCMs实施风险控制措施前/后的风险分布", children: [] },
                { title: "7.2 综合剩余风险评价", children: [] },
                { title: "7.3 软件安全级别判定", children: [] },
            ],
        },
        { title: "8 生产和生产后活动", children: [] },
        { title: "9 结论", children: [] },
        { title: "10 参考标准", children: [] },
        {
            title: "11 风险管理文件",
            children: [],
            tables: [[
                ["编号", "描述"],
                ["", "风险管理计划"],
                ["", "初步危害分析清单"],
                ["", "风险管理报告"],
                ["", "自研软件网络安全研究报告"],
                ["", "网络安全扫描报告"],
            ]],
        },
        { title: "附录A 与安全有关特征的问题识别", children: [] },
        { title: "附录B 风险分析矩阵", ref_type: "risk_analysis", children: [] },
    ],
    participants: [],
    riskMatrix: [],
    riskControls: [],
    productName: "",
};

const makeRowKey = () => `${Date.now()}-${Math.random()}`;
const cloneTemplateContent = () => JSON.parse(JSON.stringify(templateContent));

const sectionKey = (section: any) => section?._key || section?.title || section?.ref_type || "";

const normalizeTitleText = (value: any) => String(value || "").replace(/\s+/g, "");

const isAppendixASection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return title.includes("附录A") && title.includes("安全有关特征");
};

const isAppendixBSection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return title.includes("附录B") && title.includes("风险分析矩阵");
};

const isRiskMgmtFilesSection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return title.includes("风险管理文件") && /^11/.test(title);
};

const isParticipantsSection = (section: any) => {
    const rawTitle = String(section?.title || "");
    const title = normalizeTitleText(rawTitle);
    const firstTableHeader = normalizeTitleText((section?.tables?.[0]?.[0] || []).join(""));
    return section?.ref_type === "participants"
        || title.includes("风险分析参与人员")
        || (title.includes("参与") && title.includes("人员"))
        || /4[.．]2/.test(rawTitle)
        || (firstTableHeader.includes("项目角色") && firstTableHeader.includes("姓名"));
};

const isAcceptanceStandardSection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return section?.ref_type === "acceptance_standard" || (title.includes("5.2.3") && title.includes("接受标准"));
};

const isCoverSection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return section?.ref_type === "cover" || title === "风险管理报告";
};

const isRevisionSection = (section: any) => {
    const title = normalizeTitleText(section?.title);
    return section?.ref_type === "revision" || title === "文件修订记录";
};

const normalizeCoverSection = (section: any) => {
    const nextSection = JSON.parse(JSON.stringify(section || createCoverSection()));
    const table = Array.isArray(nextSection.tables?.[0]) ? nextSection.tables[0] : [];
    const firstRowText = normalizeTitleText((table[0] || []).join(""));
    if (firstRowText.includes("编制部门") && firstRowText.includes("文件版本") && table.length >= 4) {
        return nextSection;
    }
    if (firstRowText.includes("编制科室") || firstRowText.includes("编制部门") || firstRowText.includes("文件版本")) {
        const headers = table[0] || [];
        const values = table[1] || [];
        const getValue = (label: string) => {
            const idx = headers.findIndex((header: any) => normalizeTitleText(header).includes(label));
            return idx >= 0 ? values[idx] || "" : "";
        };
        nextSection.tables = [[
            ["编制部门", getValue("编制") || "", "文件版本", getValue("文件版本") || ""],
            ["编制人", getValue("编制人") || "", "日期", ""],
            ["审核人", getValue("审核人") || "", "日期", ""],
            ["批准人", getValue("批准人") || "", "日期", ""],
            ["生效日期", getValue("生效日期") || "", "", ""],
        ]];
    }
    return nextSection;
};

const ensureFrontMatterSections = (content: any) => {
    const nextContent = JSON.parse(JSON.stringify({ ...emptyContent, ...(content || {}) }));
    const sections = Array.isArray(nextContent.sections) ? nextContent.sections : [];
    const cover = normalizeCoverSection(sections.find(isCoverSection) || createCoverSection());
    const revision = sections.find(isRevisionSection) || createRevisionSection();
    const bodySections = sections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
    nextContent.sections = [cover, revision, ...bodySections];
    return nextContent;
};

const isAppendixATable = (table: any) => {
    const firstRowText = normalizeTitleText((Array.isArray(table?.[0]) ? table[0] : []).join(""));
    return firstRowText.includes("问题") && firstRowText.includes("考虑的内容") && firstRowText.includes("是否适用") && firstRowText.includes("可能的危险");
};

const isAppendixBTable = (table: any) => {
    const firstRowText = normalizeTitleText((Array.isArray(table?.[0]) ? table[0] : []).join(""));
    return firstRowText.includes("危害编号")
        && firstRowText.includes("事件序列")
        && firstRowText.includes("风险控制措施")
        && firstRowText.includes("RCMID");
};

const removeAppendixReferenceLines = (value: any) => String(value || "")
    .split(/\r?\n/)
    .filter((line) => {
        const text = normalizeTitleText(line);
        return !(text.startsWith("附录A") || text.startsWith("附录B"));
    })
    .join("\n")
    .trim();

const replaceAllText = (value: any, oldText: string, newText: string) => {
    const text = String(value || "");
    if (!oldText || !newText || oldText === newText) return text;
    return text.split(oldText).join(newText);
};

const collectContentText = (content: any) => {
    const chunks: string[] = [];
    const walk = (sections: any[] = []) => {
        (sections || []).forEach((section) => {
            chunks.push(String(section.text || ""), String(section.content || ""));
            if (Array.isArray(section.tables)) {
                section.tables.forEach((table: any[]) => {
                    (table || []).forEach((row: any[]) => {
                        (row || []).forEach((cell: any) => chunks.push(String(cell || "")));
                    });
                });
            }
            walk(section.children || []);
        });
    };
    walk(content?.sections || []);
    return chunks.join("\n");
};

const inferPreviousProductName = (content: any, currentName: string) => {
    const allText = collectContentText(content);
    const candidates = Array.from(new Set([
        currentName.replace(/[0-9０-９]+$/, ""),
        currentName.replace(/[A-Za-z0-9０-９._\-（）()]+$/, ""),
    ].map((item) => item.trim()).filter((item) => item && item !== currentName && item.length >= 4)));
    return candidates.find((candidate) => allText.includes(candidate)) || "";
};

const syncProductNameInContent = (content: any, productName?: string) => {
    const currentName = String(productName || "").trim();
    const nextContent = ensureFrontMatterSections(content);
    const previousName = String(nextContent.productName || "").trim() || inferPreviousProductName(nextContent, currentName);
    if (!currentName) return nextContent;
    const shouldReplace = previousName && previousName !== currentName;

    const syncSection = (section: any) => {
        if (shouldReplace) {
            if (typeof section.text !== "undefined") {
                section.text = replaceAllText(section.text, previousName, currentName);
            }
            if (typeof section.content !== "undefined") {
                section.content = replaceAllText(section.content, previousName, currentName);
            }
            if (Array.isArray(section.tables)) {
                section.tables = section.tables.map((table: any[]) => (table || []).map((row: any[]) => (row || []).map((cell: any) => replaceAllText(cell, previousName, currentName))));
            }
        }
        section.children = (section.children || []).map(syncSection);
        return section;
    };

    nextContent.sections = (nextContent.sections || []).map(syncSection);
    nextContent.productName = currentName;
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
        "目的": `风险管理的目的是确保${pname}的危害得到了定义，评估和评价了相关风险，控制了这些风险和在寿命周期中监控这些控制措施的有效性。本公司采用的主要方式和程序来自于GB/T 42062、ISO14971和YY/T 1406.1-2016。`,
        "审评历史": `按照评审记录的模板，在风险管理过程中，形成了以下风险相关文件（部分含评审记录）：\n《风险管理计划》及评审记录\n《初步危害分析清单》及评审记录\n《网络安全漏洞自评报告》\n《自研软件网络安全研究报告》\n《风险管理报告》及评审记录`,
        "风险分析方式": `根据YY/T 0316、ISO14971和风险管理控制程序，对于每个危害发生概率、危害程度的评估、综合考虑概率和危害程度的风险等级、风险可接受准则如下所示。`,
        "危害识别": `与合理可预见相关的环境相关的危害：\n正常使用\n不正确的使用\n人为恶意使用\n考虑的危害包括：\n对患者的危害\n对操作者的危害\n对信息资产的危害\n危害初步原因的考虑应包括:\n用户界面\n患者或者临床用户的忽视\n人因工程\n硬件故障\n软件故障\n集成错误\n环境条件\n网络安全\n危害重点考虑的原因应包括：\n网络工具；\n系统部件的集成，包括硬件和软件；\n用户界面，包括命令语言，警告和错误信息；\n在用户界面和用户手册中文字翻译的准确性；\n用户预期或非预期情况下数据的保护；\n第三方软件。`,
        "与合理可预见相关的环境相关的危害": `与合理可预见相关的环境相关的危害：\n正常使用\n不正确的使用\n人为恶意使用`,
        "考虑的危害包括": `考虑的危害包括：\n对患者的危害\n对操作者的危害\n对信息资产的危害`,
        "危害初步原因的考虑应包括": `危害初步原因的考虑应包括:\n用户界面\n患者或者临床用户的忽视\n人因工程\n硬件故障\n软件故障\n集成错误\n环境条件\n网络安全`,
        "危害重点考虑的原因应包括": `危害重点考虑的原因应包括：\n网络工具；\n系统部件的集成，包括硬件和软件；\n用户界面，包括命令语言，警告和错误信息；\n在用户界面和用户手册中文字翻译的准确性；\n用户预期或非预期情况下数据的保护；\n第三方软件。`,
        "严重度定义": `见图1`,
        "发生概率定义": `见图2`,
        "风险分析": `根据YY/T 0316、ISO14971和风险管理控制程序，${pname}的风险分析过程应该定义可能的危险（源），评估每个危险情况，评估每个风险的可接受程度，降低风险的方式和评审由于采取风险控制措施带来的风险。在所有这些风险已经被分析后，这些程序和结果的记录见本报告。`,
        "生产和生产后活动": `在风险管理计划中，已经描述了生产和生产后信息收集的方式。\n通过对执行这些过程中记录的评审，来评审是否引入了风险和开始一个新的风险分析和管理过程。\n截至目前搜集到的所有信息，没有新的风险产生。`,
        "参考标准": `YY/T 0664-2020 医疗器械软件 软件生存周期过程\nGB/T 42062-2022 医疗器械 风险管理对医疗器械的应用\nYY/T 1406.1-2016 医疗器械软件 第1部分：YY/T 0316应用于医疗器械软件的指南\nISO 14971-2019 医疗器械-风险管理对医疗器械的应用\n《医疗器械软件注册技术审查指导原则》（2022年第9号）\n《医疗器械网络安全注册审查指导原则》（2022年第7号）\n《人工智能医疗器械注册审查指导原则》（2022年第8号）\nFDA-Content of Premarket Submissions for Device Software Functions`,
        "风险控制方案分析": `风险管理小组已经识别合理适用的风险控制措施来降低风险到可接受水平，具体风险控制措施的分析详见附录B。`,
        "风险控制措施的实施": `通过对${pname}产品风险分析和风险评价的结果的分析，所有的风险控制措施已经被识别并且所有风险控制措施已经在设计中实施。\n识别出的所有风险控制措施已经被验证，详见附录B的证据列，包括但不限于《软件测试报告》和《用户测试报告》。实施和验证的风险控制措施列表如下所示：`,
        "剩余风险分析和风险/受益分析": `${pname}产品的所有单个剩余风险都已经控制在可接受的范围内，剩余风险可以接受，详见附录B，风险/受益分析评价列。`,
        "由风险控制措施产生的风险": `对采用的风险控制措施在评审过程中进行了分析，如果带来了新的风险，则进行分析，由风险控制措施带来的危害列表如下所示：`,
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
                if (key === "范围") {
                    section.text = product?.scope || "";
                } else if (key === "产品描述") {
                    section.text = buildProductDescription(product);
                } else if (key === "产品预期用途") {
                    section.text = product?.component || "";
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

const relocateMisplacedRiskTables = (content: any) => {
    const nextContent = ensureFrontMatterSections(content);
    let riskMgmtFilesSection: any = null;
    let appendixASection: any = null;
    let appendixBSection: any = null;
    const walk = (sections: any[] = []) => {
        (sections || []).forEach((section) => {
            if (isRiskMgmtFilesSection(section)) riskMgmtFilesSection = section;
            if (isAppendixASection(section)) appendixASection = section;
            if (isAppendixBSection(section)) appendixBSection = section;
            walk(section.children || []);
        });
    };
    walk(nextContent.sections || []);
    if (!riskMgmtFilesSection) return nextContent;
    riskMgmtFilesSection.text = removeAppendixReferenceLines(riskMgmtFilesSection.text);
    const sourceTables = Array.isArray(riskMgmtFilesSection.tables) ? riskMgmtFilesSection.tables : [];
    const moveTables = (targetSection: any, predicate: (table: any) => boolean) => {
        if (!targetSection) return;
        const misplacedTables = sourceTables.filter(predicate);
        if (misplacedTables.length === 0) return;
        const targetTables = Array.isArray(targetSection.tables) ? targetSection.tables : [];
        const existedKeys = new Set(targetTables.map((table: any) => JSON.stringify(table)));
        targetSection.tables = [
            ...targetTables,
            ...misplacedTables.filter((table: any) => !existedKeys.has(JSON.stringify(table))),
        ];
    };
    moveTables(appendixASection, isAppendixATable);
    moveTables(appendixBSection, isAppendixBTable);
    riskMgmtFilesSection.tables = sourceTables.filter((table: any) => !isAppendixATable(table) && !isAppendixBTable(table));
    return nextContent;
};

const SectionList = ({
    sections,
    depth = 0,
    activeKey,
    onSelect,
    onTitleChange,
    onAddSibling,
    onAddChild,
    onDelete,
    readOnly,
}: {
    sections: any[];
    depth?: number;
    activeKey?: string;
    onSelect: (section: any) => void;
    onTitleChange: (section: any, title: string) => void;
    onAddSibling: (section: any) => void;
    onAddChild: (section: any) => void;
    onDelete: (section: any) => void;
    readOnly: boolean;
}) => {
    return (
        <>
            {(sections || []).map((section: any) => (
                <div key={sectionKey(section)}>
                    <div
                        className={`risk-mgmt-section-item ${activeKey === sectionKey(section) ? "active" : ""}`}
                        style={{ marginLeft: depth * 14 }}
                        onClick={() => onSelect(section)}>
                        <div className="risk-mgmt-section-item-main">
                            {readOnly ? (
                                section.title
                            ) : (
                                <Input
                                    value={section.title}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelect(section);
                                    }}
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

const loadProducts = (data: any, dispatch: any) => {
    if ((data.products || []).length > 0) return;
    ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ products: res.data.rows || [] });
        }
    });
};

const loadParticipantOptions = (dispatch: any) => {
    Api.list_risk_participant({ page_index: 0, page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ participantOptions: res.data?.rows || [] });
        }
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isAdd = location.pathname.includes("/add");
    const isView = location.pathname.includes("/view/");
    const [form] = Form.useForm();
    const contentCardRef = useRef<HTMLDivElement>(null);
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        detail: {},
        content: emptyContent,
        participants: [],
        participantOptions: [],
        selectedParticipantIds: [],
        participantsTouched: false,
        products: [],
        activeSectionKey: "",
        selectedProductId: undefined,
        prodRcms: [],
        prodHazs: [],
        hazs: [],
    });

    useEffect(() => {
        loadProducts(data, dispatch);
        loadParticipantOptions(dispatch);
        if (isAdd) {
            form.resetFields();
            const content = cloneTemplateContent();
            const defaultSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
            dispatch({ detail: {}, content, participants: [], selectedParticipantIds: [], participantsTouched: false, activeSectionKey: sectionKey(defaultSection) });
            return;
        }
        if (!params.id) return;
        dispatch({ loading: true });
        Api.get_risk_mgmt_doc({ id: params.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const detail = res.data || {};
                let content = syncProductNameInContent(relocateMisplacedRiskTables(detail.content || emptyContent), detail.product_name);
                content = syncFileVersionInCover(content, detail.version);
                const participants = (content.participants || []).map((row: any) => ({ ...row, _rowKey: makeRowKey() }));
                const selectedParticipantIds = participants.map((row: any) => row.id).filter(Boolean);
                const defaultSection = (content.sections || []).find((section: any) => !isCoverSection(section) && !isRevisionSection(section));
                form.setFieldsValue(detail);
                dispatch({ loading: false, detail, content, participants, selectedParticipantIds, participantsTouched: false, activeSectionKey: sectionKey(defaultSection), selectedProductId: detail.product_id });
                loadRiskLookupData(detail.product_id);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    }, [params.id, isAdd]);

    const loadRiskLookupData = (productId?: any) => {
        if (productId) {
            ApiProdRcm.list_prod_rcm({ prod_id: productId, page_index: 0, page_size: 10000 }).then((rcmRes: any) => {
                if (rcmRes.code === ApiProdRcm.C_OK) {
                    dispatch({ prodRcms: rcmRes.data?.rows || [] });
                }
            });
            ApiProdHaz.list_prod_haz({ prod_id: productId, page_index: 0, page_size: 10000 }).then((hazRes: any) => {
                if (hazRes.code === ApiProdHaz.C_OK) {
                    dispatch({ prodHazs: hazRes.data?.rows || [] });
                }
            });
        } else {
            dispatch({ prodRcms: [], prodHazs: [] });
        }
        if (!productId) {
            dispatch({ hazs: [] });
            return;
        }
        ApiHaz.list_haz({ page_index: 0, page_size: 10000 }).then((hazRes: any) => {
            if (hazRes.code === ApiHaz.C_OK) {
                dispatch({ hazs: hazRes.data?.rows || [] });
            }
        });
    };

    useEffect(() => {
        if (!isAdd) return;
        loadRiskLookupData(data.selectedProductId);
    }, [isAdd, data.selectedProductId]);

    // 正文默认文案填充（仅填空，不覆盖已有内容）：产品就绪后对空章节带出默认正文，兼容弹窗新建的文档
    useEffect(() => {
        if (isView) return;
        const sections = data.content?.sections;
        if (!Array.isArray(sections) || sections.length === 0) return;
        const productId = data.selectedProductId || data.detail?.product_id;
        if (!productId) return;
        const product = (data.products || []).find((p: any) => p.id === productId);
        if (!product) return;
        const filled = fillProductTextSections(data.content, product);
        if (JSON.stringify(filled) !== JSON.stringify(data.content)) {
            dispatch({ content: filled });
        }
    }, [isView, data.products, data.selectedProductId, data.detail?.product_id]);

    const doSave = () => {
        form.validateFields().then((values) => {
            const participantSource = data.participantsTouched || (data.participants || []).length
                ? (data.participants || [])
                : (data.participantOptions || []);
            const participants = participantSource.map(({ _rowKey, ...row }: any) => row);
            const selectedProduct = (data.products || []).find((p: any) => p.id === (values.product_id || data.selectedProductId || data.detail?.product_id));
            const productName = selectedProduct?.name || data.detail?.product_name || values.product_name;
            const content = syncProductNameInContent({ ...(data.content || emptyContent), participants }, productName);
            dispatch({ saving: true });
            const request = isAdd
                ? Api.add_risk_mgmt_doc({ ...values, content })
                : Api.update_risk_mgmt_doc({ ...data.detail, ...values, content });
            request.then((res: any) => {
                dispatch({ saving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    navigate("/risk_mgmt_docs");
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
            const res: any = await Api.export_risk_mgmt_doc({ id: params.id });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "导出失败");
            }
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const deleteParticipantRow = (row: any, currentRows: any[]) => {
        const sameParticipant = (item: any) => (
            row.id ? Number(item.id) === Number(row.id) : item.role === row.role && item.name === row.name
        );
        const participants = (currentRows || []).filter((item: any) => !sameParticipant(item));
        dispatch({ participants, participantsTouched: true });
    };

    const updateParticipantCell = (rowIndex: number, field: "role" | "name", value: string, currentRows: any[]) => {
        const participants = (currentRows || []).map((row: any, index: number) => (
            index === rowIndex ? { ...row, [field]: value, _rowKey: row._rowKey || makeRowKey() } : row
        ));
        dispatch({ participants, participantsTouched: true });
    };

    const findSectionByKey = (sections: any[] = [], key: string): any => {
        for (const section of sections || []) {
            if (sectionKey(section) === key) return section;
            const child = findSectionByKey(section.children || [], key);
            if (child) return child;
        }
        return null;
    };

    const allSections = data.content.sections || [];
    const frontMatterSections = allSections.filter((section: any) => isCoverSection(section) || isRevisionSection(section));
    const bodySections = allSections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
    const activeSection = findSectionByKey(allSections || [], data.activeSectionKey) || bodySections[0];

    const findSectionContext = (sections: any[] = [], key: string, parent?: any): any => {
        for (const section of sections || []) {
            if (sectionKey(section) === key) {
                return { section, parent, siblings: sections };
            }
            const child = findSectionContext(section.children || [], key, section);
            if (child) return child;
        }
        return null;
    };

    const stripSectionNumber = (value?: string) => String(value || "")
        .replace(/^[0-9０-９]+(?:[.．][0-9０-９]+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .replace(/[：:]+$/, "")
        .trim();

    const extractRcmCodes = (value?: any): string[] => {
        const text = String(value || "").toUpperCase();
        const matches = text.match(/RCM\s*\d+/g) || [];
        return Array.from(new Set(matches.map((item) => item.replace(/\s+/g, ""))));
    };

    const getRcmHazMatches = (rcmCode: string) => (data.hazs || []).filter((haz: any) => {
        const relatedRcms = extractRcmCodes(`${haz?.rcms || ""}\n${haz?.deal || ""}`);
        return relatedRcms.includes(rcmCode);
    });

    const getRcmIntroducedTableMeta = (section: any) => {
        const rows = Array.isArray(section?.tables?.[0]) ? section.tables[0] : [];
        const firstRow = rows[0] || [];
        const firstText = (firstRow || []).join("");
        const hasHeader = /RCM编号|引入的危害|风险分析|风险控制措施/.test(firstText);
        const headers = hasHeader ? firstRow : ["RCM编号", "引入的危害", "RCM引入的风险分析", "风险控制措施"];
        const normalize = (value: any) => String(value || "").replace(/\s+/g, "");
        const findColumn = (keywords: string[], fallback: number) => {
            const idx = (headers || []).findIndex((header: any) => keywords.some((keyword) => normalize(header).includes(keyword)));
            return idx >= 0 ? idx : fallback;
        };
        return {
            rows,
            hasHeader,
            dataStartIndex: hasHeader ? 1 : 0,
            rcmCol: findColumn(["RCM编号", "RCM"], 0),
            hazCol: findColumn(["引入的危害", "危害"], 1),
            analysisCol: findColumn(["风险分析"], 2),
            measureCol: findColumn(["风险控制措施", "控制措施"], 3),
        };
    };

    const buildRcmIntroducedHazRows = (section: any) => {
        const meta = getRcmIntroducedTableMeta(section);
        const rows: any[] = [];
        meta.rows.slice(meta.dataStartIndex).forEach((sourceRow: any[], offset: number) => {
            const sourceRowIndex = meta.dataStartIndex + offset;
            const rawRcmValue = String(sourceRow?.[meta.rcmCol] || "");
            const rcmSearchText = rawRcmValue.trim() ? rawRcmValue : sourceRow?.[meta.measureCol];
            const rcmCode = extractRcmCodes(rcmSearchText)[0] || "";
            const measure = sourceRow?.[meta.measureCol] || sourceRow?.[meta.rcmCol] || "";
            const matches = rcmCode ? getRcmHazMatches(rcmCode) : [];
            if (matches.length === 0) {
                rows.push({
                    key: `${sourceRowIndex}-0`,
                    sourceRowIndex,
                    rawRcmValue,
                    rcmCode,
                    hazCode: rcmCode ? "未匹配到HAZ" : "",
                    analysis: "",
                    measure,
                });
                return;
            }
            matches.forEach((haz: any, matchIndex: number) => {
                rows.push({
                    key: `${sourceRowIndex}-${matchIndex}`,
                    sourceRowIndex,
                    rawRcmValue,
                    rcmCode,
                    hazCode: haz.code || "",
                    analysis: haz.situation || haz.event || haz.source || "",
                    measure,
                });
            });
        });
        return { ...meta, displayRows: rows };
    };

    const deriveTextFromParentSection = (section: any): string => {
        const ctx = findSectionContext(data.content.sections || [], sectionKey(section));
        const parentText = String(ctx?.parent?.text || "");
        if (!ctx?.parent || !parentText.trim()) return "";
        const currentTitle = stripSectionNumber(section.title);
        if (!currentTitle) return "";
        const siblingTitles = (ctx.siblings || [])
            .filter((item: any) => sectionKey(item) !== sectionKey(section))
            .map((item: any) => stripSectionNumber(item.title))
            .filter(Boolean);
        const lines = parentText.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
        const startIdx = lines.findIndex((line) => line.includes(currentTitle));
        if (startIdx < 0) return "";
        const picked: string[] = [];
        for (let idx = startIdx; idx < lines.length; idx += 1) {
            const line = lines[idx];
            if (idx > startIdx && siblingTitles.some((title: string) => line.includes(title))) {
                break;
            }
            picked.push(line);
        }
        return picked.join("\n").trim();
    };

    const selectSection = (section: any) => {
        dispatch({ activeSectionKey: sectionKey(section) });
        setTimeout(() => {
            contentCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
    };

    const updateSectionText = (key: string, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                return { ...section, text: value };
            }
            return { ...section, children: update(section.children || []) };
        });
        dispatch({
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const updateSectionImageUrl = (key: string, imageUrl: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                return { ...section, image_url: imageUrl };
            }
            return { ...section, children: update(section.children || []) };
        });
        dispatch({
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const uploadAcceptanceImage = (section: any, file: File) => {
        if (!file.type.startsWith("image/")) {
            message.error("请选择图片文件");
            return false;
        }
        const reader = new FileReader();
        reader.onload = () => {
            updateSectionImageUrl(sectionKey(section), String(reader.result || ""));
            message.success("图片已更新，请保存文档");
        };
        reader.onerror = () => message.error("图片读取失败");
        reader.readAsDataURL(file);
        return false;
    };

    const updateSectionTableCell = (key: string, tableIndex: number, rowIndex: number, cellIndex: number, value: string) => {
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === key) {
                const tables = Array.isArray(section.tables) ? section.tables.map((table: any[]) => (table || []).map((row: any[]) => [...(row || [])])) : [];
                if (!tables[tableIndex]) {
                    tables[tableIndex] = [["RCM编号", "引入的危害", "RCM引入的风险分析", "风险控制措施"]];
                }
                if (!tables[tableIndex][rowIndex]) {
                    tables[tableIndex][rowIndex] = [];
                }
                tables[tableIndex][rowIndex][cellIndex] = value;
                return { ...section, tables };
            }
            return { ...section, children: update(section.children || []) };
        });
        dispatch({
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const addRcmIntroducedRow = (section: any) => {
        const key = sectionKey(section);
        const update = (sections: any[] = []): any[] => (sections || []).map((item) => {
            if (sectionKey(item) === key) {
                const tables = Array.isArray(item.tables) ? item.tables.map((table: any[]) => (table || []).map((row: any[]) => [...(row || [])])) : [];
                if (!tables[0] || tables[0].length === 0) {
                    tables[0] = [["RCM编号", "引入的危害", "RCM引入的风险分析", "风险控制措施"]];
                }
                tables[0].push(["", "", "", ""]);
                return { ...item, tables };
            }
            return { ...item, children: update(item.children || []) };
        });
        dispatch({
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const deleteRcmIntroducedRow = (section: any, rowIndex: number) => {
        const key = sectionKey(section);
        const meta = getRcmIntroducedTableMeta(section);
        if (rowIndex < meta.dataStartIndex) return;
        const update = (sections: any[] = []): any[] => (sections || []).map((item) => {
            if (sectionKey(item) === key) {
                const tables = Array.isArray(item.tables) ? item.tables.map((table: any[]) => (table || []).map((row: any[]) => [...(row || [])])) : [];
                if (tables[0]) {
                    tables[0] = tables[0].filter((_row: any[], index: number) => index !== rowIndex);
                }
                return { ...item, tables };
            }
            return { ...item, children: update(item.children || []) };
        });
        dispatch({
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const updateSectionTitle = (targetSection: any, title: string) => {
        const targetKey = sectionKey(targetSection);
        const update = (sections: any[] = []): any[] => (sections || []).map((section) => {
            if (sectionKey(section) === targetKey) {
                return { ...section, title };
            }
            return { ...section, children: update(section.children || []) };
        });
        const nextKey = targetSection._key || title || targetSection.ref_type || targetKey;
        dispatch({
            activeSectionKey: nextKey,
            content: {
                ...(data.content || emptyContent),
                sections: update(data.content.sections || []),
            },
        });
    };

    const parseSectionNumber = (title?: string) => String(title || "").trim().match(/^([0-9０-９]+(?:[.．][0-9０-９]+)*)/)?.[1]?.replace(/．/g, ".") || "";

    const makeNewSection = (title: string) => ({
        _key: makeRowKey(),
        title,
        children: [],
        text: "",
    });

    const buildNewSectionTitle = (siblings: any[] = [], parent?: any) => {
        const parentNo = parent ? parseSectionNumber(parent.title) : "";
        const numbers = (siblings || [])
            .map((item) => parseSectionNumber(item?.title))
            .filter((no) => {
                if (parentNo) return no.startsWith(`${parentNo}.`) && no.split(".").length === parentNo.split(".").length + 1;
                return no && no.split(".").length === 1;
            })
            .map((no) => Number(no.split(".").pop()))
            .filter((num) => Number.isFinite(num));
        const nextIndex = Math.max(0, ...numbers) + 1;
        const nextNo = parentNo ? `${parentNo}.${nextIndex}` : `${nextIndex}`;
        return `${nextNo} 新目录`;
    };

    const addRootSection = () => {
        const nextSection = makeNewSection(buildNewSectionTitle(bodySections));
        dispatch({
            activeSectionKey: sectionKey(nextSection),
            content: {
                ...(data.content || emptyContent),
                sections: [...(data.content.sections || []), nextSection],
            },
        });
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
        dispatch({
            activeSectionKey: nextActiveKey || data.activeSectionKey,
            content: {
                ...(data.content || emptyContent),
                sections: nextSections,
            },
        });
    };

    const deleteSection = (targetSection: any) => {
        const targetKey = sectionKey(targetSection);
        const update = (sections: any[] = []): any[] => (sections || [])
            .filter((section) => sectionKey(section) !== targetKey)
            .map((section) => ({ ...section, children: update(section.children || []) }));
        const nextSections = update(data.content.sections || []);
        const nextBodySections = nextSections.filter((section: any) => !isCoverSection(section) && !isRevisionSection(section));
        dispatch({
            activeSectionKey: data.activeSectionKey === targetKey ? sectionKey(nextBodySections[0]) : data.activeSectionKey,
            content: {
                ...(data.content || emptyContent),
                sections: nextSections,
            },
        });
    };

    const riskText = (row: any, type: "init" | "cur") => {
        const rate = type === "init" ? row.init_rate : row.cur_rate;
        const degree = type === "init" ? row.init_degree : row.cur_degree;
        const level = type === "init" ? row.init_level : row.cur_level;
        return {
            rate: HAZDICT_RATES[rate] ?? rate ?? "",
            degree: HAZDICT_DEGREES[degree] ?? degree ?? "",
            level: HAZDICT_LEVELS[level] ?? level ?? "",
        };
    };

    const renderProdHazMatrix = () => {
        const rows = data.prodHazs || [];
        if (rows.length === 0) {
            return <div className="risk-mgmt-section-tip">当前产品暂无产品 HAZ 管理数据。</div>;
        }
        return (
            <div className="risk-mgmt-matrix-wrap">
                <table className="risk-mgmt-matrix-table">
                    <thead>
                        <tr>
                            <th rowSpan={2}>危害编号</th>
                            <th rowSpan={2}>危险（源）</th>
                            <th rowSpan={2}>事件序列</th>
                            <th rowSpan={2}>危险情况</th>
                            <th rowSpan={2}>伤害</th>
                            <th colSpan={3}>初始风险</th>
                            <th rowSpan={2}>风险控制措施</th>
                            <th rowSpan={2}>RCM ID</th>
                            <th rowSpan={2}>证据，包括风险验证（详见软件测试报告）</th>
                            <th colSpan={3}>剩余风险</th>
                            <th rowSpan={2}>收益是否大于风险（Y/N）</th>
                            <th rowSpan={2}>分类</th>
                        </tr>
                        <tr>
                            <th>概率</th>
                            <th>危害程度</th>
                            <th>风险水平</th>
                            <th>概率</th>
                            <th>危害程度</th>
                            <th>风险水平</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row: any) => {
                            const initRisk = riskText(row, "init");
                            const curRisk = riskText(row, "cur");
                            return (
                                <tr key={row.id || row.haz_id || row.code}>
                                    <td>{row.code}</td>
                                    <td>{row.source}</td>
                                    <td>{row.event}</td>
                                    <td>{row.situation}</td>
                                    <td>{row.damage}</td>
                                    <td>{initRisk.rate}</td>
                                    <td>{initRisk.degree}</td>
                                    <td>{initRisk.level}</td>
                                    <td>{row.deal}</td>
                                    <td>{row.rcms}</td>
                                    <td>{row.evidence}</td>
                                    <td>{curRisk.rate}</td>
                                    <td>{curRisk.degree}</td>
                                    <td>{curRisk.level}</td>
                                    <td>{row.benefit_flag ? "Y" : "N"}</td>
                                    <td>{row.category}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
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

    const renderParticipantsTable = (section: any) => {
        const importedRows = (section?.tables?.[0] || []).slice(1).map((row: any[], index: number) => ({
            _rowKey: `imported-${index}`,
            role: row?.[0] || "",
            name: row?.[1] || "",
        })).filter((row: any) => row.role || row.name);
        const editableRows = (data.participantOptions || []).length ? data.participantOptions : importedRows;
        const viewRows = (data.participants || []).length ? data.participants : importedRows;
        const displayRows = isView
            ? viewRows
            : (data.participantsTouched || (data.participants || []).length ? data.participants : editableRows);
        return (
            <div className="risk-mgmt-section-content">
                <table className="risk-mgmt-section-table risk-mgmt-participant-static-table">
                    <tbody>
                        <tr>
                            <td><strong>项目角色</strong></td>
                            <td><strong>姓名</strong></td>
                            {!isView && <td><strong>操作</strong></td>}
                        </tr>
                        {displayRows.map((row: any, index: number) => (
                            <tr key={row.id || row._rowKey || `${row.role}-${row.name}-${index}`}>
                                <td>
                                    {isView ? row.role || "" : (
                                        <input
                                            className="risk-mgmt-participant-input"
                                            value={row.role || ""}
                                            onChange={(event) => updateParticipantCell(index, "role", event.target.value, displayRows)}
                                        />
                                    )}
                                </td>
                                <td>
                                    {isView ? row.name || "" : (
                                        <input
                                            className="risk-mgmt-participant-input"
                                            value={row.name || ""}
                                            onChange={(event) => updateParticipantCell(index, "name", event.target.value, displayRows)}
                                        />
                                    )}
                                </td>
                                {!isView && (
                                    <td>
                                        <Button type="link" danger size="small" onClick={() => deleteParticipantRow(row, displayRows)}>
                                            删除
                                        </Button>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {!displayRows.length && (
                            <tr>
                                <td colSpan={isView ? 2 : 3}>暂无参与人员，请先到“风险分析参与人员”总表维护。</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderAcceptanceMatrix = () => {
        const matrixRows = [
            { rate: "经常", score: "5", cells: ["5A", "5B", "5C", "5D", "5E"], levels: ["bad", "bad", "bad", "bad", "bad"] },
            { rate: "有时", score: "4", cells: ["4A", "4B", "4C", "4D", "4E"], levels: ["bad", "bad", "bad", "bad", "bad"] },
            { rate: "偶然", score: "3", cells: ["3A", "3B", "3C", "3D", "3E"], levels: ["ok", "warn", "bad", "bad", "bad"] },
            { rate: "很少", score: "2", cells: ["2A", "2B", "2C", "2D", "2E"], levels: ["ok", "warn", "warn", "bad", "bad"] },
            { rate: "非常少", score: "1", cells: ["1A", "1B", "1C", "1D", "1E"], levels: ["ok", "ok", "warn", "warn", "warn"] },
        ];

        return (
            <div className="risk-mgmt-acceptance-wrap">
                <table className="risk-mgmt-acceptance-table">
                    <tbody>
                        <tr>
                            <th className="acceptance-risk-title" rowSpan={2} colSpan={3}>风险值</th>
                            <th className="acceptance-degree-title" colSpan={5}>严重度</th>
                        </tr>
                        <tr>
                            {["可忽略", "轻度", "严重", "危重的", "灾难性的"].map((label, index) => (
                                <th key={label}>
                                    <div>{label}</div>
                                    <div>{String.fromCharCode(65 + index)}</div>
                                </th>
                            ))}
                        </tr>
                        {matrixRows.map((row, rowIndex) => (
                            <tr key={row.score}>
                                {rowIndex === 0 && <th className="acceptance-rate-title" rowSpan={5}>发生概率</th>}
                                <th>{row.rate}</th>
                                <th>{row.score}</th>
                                {row.cells.map((cell, cellIndex) => (
                                    <td key={cell} className={`risk-level-${row.levels[cellIndex]}`}>{cell}</td>
                                ))}
                            </tr>
                        ))}
                        <tr>
                            <td className="acceptance-legend-red">红色</td>
                            <td colSpan={7}><strong>不可接受：</strong>这类风险本质上不可接受。必须寻求风险降低措施。</td>
                        </tr>
                        <tr>
                            <td className="acceptance-legend-warn">橙色</td>
                            <td colSpan={7}><strong>进一步降低的研究：</strong>这类风险必须降低到合理可行的最低限度才可视为可接受。</td>
                        </tr>
                        <tr>
                            <td className="acceptance-legend-green">绿色</td>
                            <td colSpan={7}><strong>可忽略：</strong>这类风险实际上可接受，但只可挑选一步寻求风险降低措施。</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    };

    const renderRiskDistMatrix = (rows: any[], caption: string, keySuffix: string) => {
        const RATE_ROWS = [
            { rate: "经常", score: "5" },
            { rate: "有时", score: "4" },
            { rate: "偶然", score: "3" },
            { rate: "很少", score: "2" },
            { rate: "非常少", score: "1" },
        ];
        const RISK_LEVELS = [
            ["bad", "bad", "bad", "bad", "bad"],
            ["bad", "bad", "bad", "bad", "bad"],
            ["ok", "warn", "bad", "bad", "bad"],
            ["ok", "warn", "warn", "bad", "bad"],
            ["ok", "ok", "warn", "warn", "warn"],
        ];
        const SEV_LABELS = ["可忽略", "轻度", "严重", "危重的", "灾难性的"];
        const dataRows = Array.isArray(rows) ? rows.slice(1) : [];
        const counts = RATE_ROWS.map((_, ri) => {
            const src = dataRows[ri] || [];
            return SEV_LABELS.map((__, ci) => {
                const v = Number(src[ci + 1]);
                return Number.isFinite(v) ? v : 0;
            });
        });
        const colTotals = SEV_LABELS.map((_, ci) => counts.reduce((sum, r) => sum + r[ci], 0));
        const grandTotal = colTotals.reduce((a, b) => a + b, 0);
        return (
            <div className="risk-mgmt-matrix-block" key={keySuffix}>
                {caption ? <div className="risk-mgmt-matrix-caption">{caption}</div> : null}
                <div className="risk-mgmt-acceptance-wrap">
                    <table className="risk-mgmt-acceptance-table risk-mgmt-dist-table">
                        <tbody>
                            <tr>
                                <th className="acceptance-risk-title" rowSpan={2} colSpan={3}>风险值</th>
                                <th className="acceptance-degree-title" colSpan={5}>严重度</th>
                                <th rowSpan={2}>总计</th>
                            </tr>
                            <tr>
                                {SEV_LABELS.map((label, index) => (
                                    <th key={label}>
                                        <div>{label}</div>
                                        <div>{String.fromCharCode(65 + index)}</div>
                                    </th>
                                ))}
                            </tr>
                            {RATE_ROWS.map((row, rowIndex) => {
                                const rowTotal = counts[rowIndex].reduce((a, b) => a + b, 0);
                                return (
                                    <tr key={row.score}>
                                        {rowIndex === 0 && <th className="acceptance-rate-title" rowSpan={5}>发生概率</th>}
                                        <th>{row.rate}</th>
                                        <th>{row.score}</th>
                                        {counts[rowIndex].map((cnt, cellIndex) => (
                                            <td key={cellIndex} className={`risk-level-${RISK_LEVELS[rowIndex][cellIndex]}`}>{cnt}</td>
                                        ))}
                                        <td className="dist-total-cell">{rowTotal}</td>
                                    </tr>
                                );
                            })}
                            <tr>
                                <th className="dist-total-cell" colSpan={3}>总计</th>
                                {colTotals.map((t, ci) => (
                                    <td key={ci} className="dist-total-cell">{t}</td>
                                ))}
                                <td className="dist-total-cell">{grandTotal}</td>
                            </tr>
                            <tr>
                                <td className="acceptance-legend-red">红色</td>
                                <td colSpan={8}><strong>不可接受：</strong>这类风险本质上不可接受。必须寻求风险降低措施。</td>
                            </tr>
                            <tr>
                                <td className="acceptance-legend-warn">橙色</td>
                                <td colSpan={8}><strong>进一步降低的研究：</strong>这类风险必须降低到合理可行的最低限度才可视为可接受。</td>
                            </tr>
                            <tr>
                                <td className="acceptance-legend-green">绿色</td>
                                <td colSpan={8}><strong>可忽略：</strong>这类风险实际上可接受，但仍应尽可能寻求风险降低措施。</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderAcceptanceStandard = (section: any) => {
        const imageUrl = String(section?.image_url || section?.img_url || "").trim();
        return (
            <div className="risk-mgmt-section-content">
                {!isView && (
                    <Space className="risk-mgmt-acceptance-actions">
                        <Upload
                            accept="image/*"
                            showUploadList={false}
                            beforeUpload={(file) => uploadAcceptanceImage(section, file as File)}>
                            <Button icon={<UploadOutlined />}>{imageUrl ? "更换图片" : "上传图片"}</Button>
                        </Upload>
                        {imageUrl && (
                            <Button onClick={() => updateSectionImageUrl(sectionKey(section), "")}>
                                使用默认表格
                            </Button>
                        )}
                    </Space>
                )}
                {imageUrl ? (
                    <div className="risk-mgmt-acceptance-image-box">
                        <img src={imageUrl} alt="接受标准" />
                    </div>
                ) : renderAcceptanceMatrix()}
            </div>
        );
    };

    const renderActiveSectionContent = () => {
        if (!activeSection) {
            return <div className="empty">请选择左侧目录</div>;
        }
        if (isParticipantsSection(activeSection)) {
            return renderParticipantsTable(activeSection);
        }
        if (isAcceptanceStandardSection(activeSection)) {
            return renderAcceptanceStandard(activeSection);
        }
        if (activeSection.ref_type === "review") {
            return (
                <div className="risk-mgmt-section-content">
                    {(Array.isArray(activeSection.tables) ? activeSection.tables : []).map((rows: any[], ti: number) => (
                        <div className="risk-mgmt-section-table-block" key={ti} style={{ marginBottom: 16 }}>
                            <div style={{ fontWeight: 600, margin: "6px 0" }}>{ti === 0 ? "评审内容" : "参评人员签字"}</div>
                            <ReviewTable grid={rows} />
                        </div>
                    ))}
                </div>
            );
        }
        const tables = Array.isArray(activeSection.tables) ? activeSection.tables : [];
        const activeTitle = String(activeSection.title || "");
        const isProductRcmSection = /风险控制措施的实施/.test(activeTitle);
        const isRiskDistSection = /风险分布/.test(activeTitle);
        const isRcmIntroducedHazSection = /由风险控制措施产生的风险|RCM带来的危害/.test(activeTitle);
        const isAppendixBRiskMatrixSection = isAppendixBSection(activeSection);
        const shouldShowProductRcms = !isRcmIntroducedHazSection && isProductRcmSection && (data.prodRcms || []).length > 0;
        const rcmIntroducedTable = isRcmIntroducedHazSection ? buildRcmIntroducedHazRows(activeSection) : null;
        const rcmIntroducedHazRows = rcmIntroducedTable?.displayRows || [];
        const sectionText = activeSection.text || activeSection.content || deriveTextFromParentSection(activeSection);
        return (
            <div className="risk-mgmt-section-content">
                {isView ? (
                    sectionText ? (
                        <div className="risk-mgmt-section-text">{sectionText}</div>
                    ) : null
                ) : (
                    <Input.TextArea
                        value={sectionText}
                        onChange={(e) => updateSectionText(sectionKey(activeSection), e.target.value)}
                        autoSize={{ minRows: 5, maxRows: 18 }}
                        placeholder="请输入章节内容"
                    />
                )}
                {isAppendixBRiskMatrixSection ? (
                    renderProdHazMatrix()
                ) : isRcmIntroducedHazSection ? (
                    <div className="risk-mgmt-rcm-block">
                        <div className="risk-mgmt-rcm-title">RCM带来的危害</div>
                        {rcmIntroducedHazRows.length > 0 ? (
                            <table className="risk-mgmt-rcm-native-table risk-mgmt-rcm-haz-table">
                                <thead>
                                    <tr>
                                        <th>RCM编号</th>
                                        <th>引入的危害</th>
                                        <th>RCM引入的风险分析</th>
                                        <th>风险控制措施</th>
                                        {!isView && <th>操作</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rcmIntroducedHazRows.map((row: any) => (
                                        <tr key={row.key}>
                                            <td>
                                                {isView ? row.rcmCode : (
                                                    <Input
                                                        size="small"
                                                        value={row.rawRcmValue}
                                                        placeholder="RCM编号"
                                                        onChange={(e) => updateSectionTableCell(sectionKey(activeSection), 0, row.sourceRowIndex, rcmIntroducedTable?.rcmCol ?? 0, e.target.value)}
                                                    />
                                                )}
                                            </td>
                                            <td>{row.hazCode}</td>
                                            <td>{row.analysis}</td>
                                            <td>
                                                {isView ? row.measure : (
                                                    <Input.TextArea
                                                        autoSize={{ minRows: 1, maxRows: 4 }}
                                                        value={row.measure}
                                                        placeholder="风险控制措施"
                                                        onChange={(e) => updateSectionTableCell(sectionKey(activeSection), 0, row.sourceRowIndex, rcmIntroducedTable?.measureCol ?? 3, e.target.value)}
                                                    />
                                                )}
                                            </td>
                                            {!isView && (
                                                <td>
                                                    <Button
                                                        type="link"
                                                        size="small"
                                                        danger
                                                        onClick={() => deleteRcmIntroducedRow(activeSection, row.sourceRowIndex)}>
                                                        删除
                                                    </Button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="risk-mgmt-section-tip">当前章节没有导入 RCM 行，请先添加或编辑 RCM 编号。</div>
                        )}
                        {!isView && (
                            <Button size="small" className="risk-mgmt-add-rcm-row" onClick={() => addRcmIntroducedRow(activeSection)}>
                                添加RCM行
                            </Button>
                        )}
                    </div>
                ) : shouldShowProductRcms ? (
                    <div className="risk-mgmt-rcm-block">
                        <div className="risk-mgmt-rcm-title">风险控制措施列表</div>
                        <table className="risk-mgmt-rcm-native-table">
                            <thead>
                                <tr>
                                    <th>控制措施描述</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data.prodRcms || []).map((row: any) => (
                                    <tr key={row.id || row.rcm_id || row.code}>
                                        <td>{row.description}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : isRiskDistSection ? (
                    (tables.length > 0
                        ? tables
                        : [["初始风险分布（措施前）"], ["剩余风险分布（措施后）"]]
                    ).map((rows: any[], tableIndex: number) => {
                        const grid = Array.isArray(rows) ? rows : [];
                        const titles = Array.isArray(activeSection.table_titles) ? activeSection.table_titles : [];
                        const caption = titles[tableIndex] || `表${tableIndex + 3} ${(grid[0] && grid[0][0]) || ""}`.trim();
                        return renderRiskDistMatrix(grid, caption, `dist-${tableIndex}`);
                    })
                ) : tables.map((rows: any[], tableIndex: number) => (
                    <table className="risk-mgmt-section-table" key={`table-${tableIndex}`}>
                        <tbody>
                            {(rows || []).map((row: any[], rowIndex: number) => (
                                <tr key={`row-${rowIndex}`}>
                                    {(row || []).map((cell: any, cellIndex: number) => (
                                        <td key={`cell-${cellIndex}`}>
                                            {isView ? cell : (
                                                <Input.TextArea
                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                    value={cell}
                                                    onChange={(e) => updateSectionTableCell(sectionKey(activeSection), tableIndex, rowIndex, cellIndex, e.target.value)}
                                                />
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ))}
                {!sectionText && tables.length === 0 && !shouldShowProductRcms && !isRcmIntroducedHazSection && !isAppendixBRiskMatrixSection ? "当前章节暂无可展示内容" : null}
            </div>
        );
    };

    const coverSection = frontMatterSections.find((section: any) => isCoverSection(section)) || createCoverSection();
    const revisionSection = frontMatterSections.find((section: any) => isRevisionSection(section)) || createRevisionSection();

    const renderNavItems = (nodes: any[], depth: number): any => (nodes || []).map((section: any) => {
        const key = sectionKey(section);
        return (
            <div key={key}>
                <div
                    className={`pdp-nav-item${data.activeSectionKey === key ? " active" : ""}`}
                    style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => selectSection(section)}>
                    <span className="pdp-nav-title" title={section.title}>{section.title || "(未命名)"}</span>
                    {!isView && (
                        <span className="pdp-nav-ops" onClick={(e) => e.stopPropagation()}>
                            <PlusOutlined title="添加子章节" onClick={() => addChildSection(section)} />
                            <DeleteOutlined title="删除章节" onClick={() => deleteSection(section)} />
                        </span>
                    )}
                </div>
                {renderNavItems(section.children || [], depth + 1)}
            </div>
        );
    });

    const renderFrontMatterPane = (section: any) => {
        const isCover = isCoverSection(section);
        return (
            <>
                {isCover && (
                    <div className="pdp-field">
                        <div className="pdp-label">文件名</div>
                        <div className="risk-mgmt-front-file-name">风险管理报告</div>
                    </div>
                )}
                <div className="pdp-field">
                    <div className="pdp-label">{isCover ? "封面信息" : "文件修订记录"}</div>
                    {(section.tables || []).map((rows: any[], tableIndex: number) => renderFrontMatterTable(section, tableIndex, rows))}
                </div>
                {isCover && (
                    <div className="pdp-field">
                        <div className="pdp-label">{ts("risk_mgmt_doc.change_log")}</div>
                        <Form.Item name="change_log" noStyle>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
                        </Form.Item>
                    </div>
                )}
            </>
        );
    };

    const renderRightPane = () => {
        if (!activeSection) {
            return <div className="pdp-empty">请选择或新增左侧章节</div>;
        }
        if (isCoverSection(activeSection) || isRevisionSection(activeSection)) {
            return renderFrontMatterPane(activeSection);
        }
        return (
            <>
                {!isView && (
                    <div className="pdp-field">
                        <div className="pdp-label">章节标题</div>
                        <Input
                            value={activeSection.title}
                            placeholder="章节标题"
                            onChange={(e) => updateSectionTitle(activeSection, e.target.value)}
                        />
                    </div>
                )}
                {renderActiveSectionContent()}
            </>
        );
    };

    return (
        <Form
            form={form}
            component={false}
            disabled={isView}
            onValuesChange={(changed) => {
                if (Object.prototype.hasOwnProperty.call(changed, "version")) {
                    const nextContent = syncFileVersionInCover(data.content || emptyContent, changed.version);
                    dispatch({ content: nextContent });
                }
            }}>
            <div className="div-v page pdp-detail risk-mgmt-detail">
                <div className="div-h pdp-toolbar">
                    <div className="pdp-toolbar-title">
                        风险管理报告
                        <span className="pdp-meta" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                            {!isView ? (
                                <span style={{ width: 320, display: "inline-block" }}>
                                    <Form.Item
                                        name="product_id"
                                        noStyle
                                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                                        <ProductVersionSelect
                                            products={data.products}
                                            value={data.selectedProductId}
                                            namePlaceholder={ts("product.name")}
                                            versionPlaceholder={ts("product.full_version")}
                                            onChange={(value: any) => {
                                                form.setFieldValue("product_id", value);
                                                dispatch({ selectedProductId: value });
                                                loadRiskLookupData(value);
                                                const selectedProduct = (data.products || []).find((p: any) => p.id === value);
                                                const productName = selectedProduct?.name || "";
                                                const version = form.getFieldValue("version") || data.detail?.version || "";
                                                const prevParticipants = (data.content && data.content.participants) || [];
                                                const fallbackFill = () => {
                                                    let content = syncProductNameInContent(data.content || emptyContent, productName);
                                                    content = fillProductTextSections(content, selectedProduct);
                                                    dispatch({ content });
                                                };
                                                Api.preview_risk_mgmt_content({ product_id: value, version }).then((res: any) => {
                                                    if (res.code === Api.C_OK && res.data && Array.isArray(res.data.sections)) {
                                                        let content = syncProductNameInContent(res.data, productName);
                                                        content = syncFileVersionInCover(content, version);
                                                        content = { ...content, participants: prevParticipants };
                                                        const defaultSection = (content.sections || []).find((s: any) => !isCoverSection(s) && !isRevisionSection(s));
                                                        dispatch({ content, activeSectionKey: defaultSection ? sectionKey(defaultSection) : data.activeSectionKey });
                                                    } else {
                                                        fallbackFill();
                                                    }
                                                }).catch(fallbackFill);
                                            }}
                                        />
                                    </Form.Item>
                                </span>
                            ) : (
                                <span style={{ whiteSpace: "nowrap" }}>
                                    {data.detail?.product_name || ""}
                                    {data.detail?.product_full_version ? ` / ${data.detail.product_full_version}` : ""}
                                </span>
                            )}
                            <span style={{ whiteSpace: "nowrap" }}>{ts("risk_mgmt_doc.version")}：</span>
                            <Form.Item
                                name="version"
                                noStyle
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("risk_mgmt_doc.version") }) }]}>
                                <Input size="small" style={{ width: 120 }} />
                            </Form.Item>
                        </span>
                    </div>
                    <Space>
                        {!isView && (
                            <Button type="primary" loading={data.saving} onClick={doSave}>{ts("save")}</Button>
                        )}
                        {!isAdd && <Button loading={data.exporting} onClick={doExport}>导出</Button>}
                        <Button onClick={() => navigate("/risk_mgmt_docs")}>{ts("back")}</Button>
                    </Space>
                </div>

                <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                    <div className="pdp-layout">
                        <div className="pdp-nav">
                            <div className="pdp-nav-head">目录</div>
                            {!isView && (
                                <div className="pdp-nav-hint">点章节查看/编辑，右侧 ＋ 加子章节、🗑 删除；封面与文件修订记录在最上方。</div>
                            )}
                            {[coverSection, revisionSection].map((section: any) => {
                                const key = sectionKey(section);
                                return (
                                    <div
                                        key={key}
                                        className={`pdp-nav-item${data.activeSectionKey === key ? " active" : ""}`}
                                        onClick={() => selectSection(section)}>
                                        <span className="pdp-nav-title" title={section.title}>{section.title}</span>
                                    </div>
                                );
                            })}
                            {renderNavItems(bodySections, 0)}
                            {!isView && (
                                <Button className="pdp-nav-add" type="dashed" size="small" icon={<PlusOutlined />} onClick={addRootSection}>
                                    顶级目录
                                </Button>
                            )}
                        </div>

                        <div className="pdp-editor" ref={contentCardRef}>
                            {renderRightPane()}
                        </div>
                    </div>
                </Spin>
            </div>
        </Form>
    );
};
