export const MODEL_DOC_TYPES: Record<string, { title: string; keywords: string[] }> = {
    md_001: { title: "模型配置管理计划", keywords: ["模型配置管理计划"] },
    md_004: { title: "算法方案概要设计", keywords: ["算法方案概要设计"] },
    md_005: { title: "模型测试方案设计", keywords: ["模型测试方案设计"] },
    md_006: { title: "模型开发计划", keywords: ["模型开发计划"] },
    md_007: { title: "算法方案详细设计", keywords: ["算法方案详细设计"] },
    md_014: { title: "模型测试报告", keywords: ["模型测试报告"] },
    md_017: { title: "模型性能测试报告", keywords: ["模型性能测试报告"] },
    md_019: { title: "开发环境维护记录说明", keywords: ["开发环境维护记录说明", "模型开发环境"] },
    md_020: { title: "测试环境维护记录说明", keywords: ["测试环境维护记录说明", "模型测试环境"] },
    md_021: { title: "模型配置管理报告", keywords: ["模型配置管理报告"] },
    md_022: { title: "模型可追溯性分析报告", keywords: ["模型可追溯性分析报告", "可追溯性分析"] },
    pd_003: { title: "模型需求规格说明", keywords: ["模型需求规格说明"] },
    md_008_01: { title: "肺栓塞分割代码审查记录", keywords: ["代码审查记录", "肺栓塞分割代码审查"] },
    md_008_02: { title: "肺叶分割代码审查记录", keywords: ["代码审查记录", "肺叶分割代码审查"] },
    md_009_01: { title: "肺栓塞分割模型训练集构建记录", keywords: ["训练集构建记录", "肺栓塞分割模型训练集"] },
    md_009_02: { title: "肺叶分割模型训练集构建记录", keywords: ["训练集构建记录", "肺叶分割模型训练集"] },
    md_010_01: { title: "肺栓塞分割模型调优集构建记录", keywords: ["调优集构建记录", "肺栓塞分割模型调优集"] },
    md_010_02: { title: "肺叶分割模型调优集构建记录", keywords: ["调优集构建记录", "肺叶分割模型调优集"] },
    md_011_01: { title: "肺栓塞分诊模型测试集构建记录", keywords: ["测试集构建记录", "肺栓塞分诊模型测试集"] },
    md_011_02: { title: "肺叶分割模型测试集构建记录", keywords: ["测试集构建记录", "肺叶分割模型测试集"] },
    md_012_01: { title: "肺栓塞分割模型训练记录", keywords: ["模型训练记录", "肺栓塞分割模型训练"] },
    md_012_02: { title: "肺叶分割模型训练记录", keywords: ["模型训练记录", "肺叶分割模型训练"] },
    md_013_01: { title: "肺栓塞分诊模型测试记录", keywords: ["模型测试记录", "肺栓塞分诊模型测试记录"] },
    md_013_02: { title: "肺叶分割模型测试记录", keywords: ["模型测试记录", "肺叶分割模型测试记录"] },
    md_015_01: { title: "肺栓塞分割封装需求", keywords: ["封装需求", "肺栓塞分割封装"] },
    md_015_02: { title: "肺叶分割封装需求", keywords: ["封装需求", "肺叶分割封装"] },
    md_016: { title: "模型工程封装记录", keywords: ["模型工程封装记录"] },
    md_018: { title: "模型服务提交记录", keywords: ["模型服务提交记录"] },
    md_019_qr: { title: "开发环境维护记录", keywords: ["开发环境维护记录"] },
    md_020_qr: { title: "测试环境维护记录", keywords: ["测试环境维护记录"] },
    md_deq: { title: "开发设备清单", keywords: ["开发设备清单"] },
    md_teq: { title: "测试设备清单", keywords: ["测试设备清单"] },
    md_eq: { title: "模型设备清单", keywords: ["设备清单"] },
};

/** 模型文件左侧菜单：按工作阶段做二级分组。名称不改。 */
export type ModelDocMenuNode = { group: string; key: string; types: string[] };

export const MODEL_DOC_MENU: ModelDocMenuNode[] = [
    { group: "计划与需求", key: "model_plan", types: ["md_001", "pd_003", "md_006"] },
    { group: "方案设计", key: "model_design", types: ["md_004", "md_005", "md_007"] },
    {
        group: "审查、构建与训练",
        key: "model_build_train",
        types: [
            "md_008_01", "md_008_02",
            "md_009_01", "md_009_02",
            "md_010_01", "md_010_02",
            "md_011_01", "md_011_02",
            "md_012_01", "md_012_02",
        ],
    },
    { group: "测试", key: "model_test", types: ["md_013_01", "md_013_02", "md_014", "md_017"] },
    { group: "封装与提交", key: "model_pkg", types: ["md_015_01", "md_015_02", "md_016", "md_018"] },
    { group: "设备与环境维护", key: "model_env", types: ["md_eq", "md_deq", "md_019", "md_teq", "md_020"] },
    { group: "配置与追溯", key: "model_cfg", types: ["md_021", "md_022"] },
];

export const MODEL_DOC_TYPE_ORDER = MODEL_DOC_MENU.flatMap((item) => item.types);

export const getModelDocMeta = (type?: string) =>
    MODEL_DOC_TYPES[type || ""] || { title: "模型文件", keywords: [] as string[] };
