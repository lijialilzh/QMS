export const DATA_DOC_TYPES: Record<string, { title: string; keywords: string[] }> = {
    dd_001: { title: "数据采集需求", keywords: ["数据采集需求"] },
    md_002_01: { title: "数据标注规则", keywords: ["数据标注规则", "肺栓塞分割数据标注规则"] },
    md_002_02: { title: "标记规则", keywords: ["标记规则", "肺叶分割标记规则"] },
    md_003: { title: "数据标注需求", keywords: ["数据标注需求"] },
    dd_002: { title: "多中心数据回传记录", keywords: ["多中心数据回传记录", "数据回传"] },
    dd_003: { title: "数据整理记录", keywords: ["数据整理记录"] },
    dd_004: { title: "数据采集需求反馈", keywords: ["数据采集需求反馈"] },
    dd_005_01: { title: "肺栓塞分割人员培训记录", keywords: ["人员培训记录", "肺栓塞分割人员培训"] },
    dd_005_02: { title: "肺叶分割人员培训记录", keywords: ["人员培训记录", "肺叶分割人员培训"] },
    dd_006: { title: "数据标注质量评估方法", keywords: ["数据标注质量评估方法"] },
    dd_007: { title: "人员考核评价方法", keywords: ["人员考核评价方法"] },
    dd_008_01: { title: "肺栓塞分割试标注记录", keywords: ["试标注记录", "肺栓塞分割试标注"] },
    dd_008_02: { title: "肺叶分割试标注记录", keywords: ["试标注记录", "肺叶分割试标注"] },
    dd_009_01: { title: "肺栓塞分诊标注记录", keywords: ["数据标注记录", "肺栓塞分诊标注记录"] },
    dd_009_02: { title: "肺叶分割标注记录", keywords: ["数据标注记录", "肺叶分割标注记录"] },
    dd_009_03: { title: "肺栓塞分诊评测记录", keywords: ["数据标注记录", "肺栓塞分诊评测记录"] },
    dd_010: { title: "数据库上传记录", keywords: ["数据库上传记录"] },
    dd_011: { title: "数据标注需求反馈", keywords: ["数据标注需求反馈"] },
    dd_012: { title: "训练集测试集查重记录", keywords: ["查重记录", "训练集测试集查重"] },
    dd_013_01: { title: "初次考核记录-肺栓塞分割分诊", keywords: ["初次考核记录", "肺栓塞分割分诊"] },
    dd_013_02: { title: "初次考核记录-肺叶分割", keywords: ["初次考核记录", "肺叶分割"] },
    dd_013_03: { title: "定期考核记录-肺栓塞分割分诊", keywords: ["定期考核记录"] },
    dd_013_04: { title: "定期考核记录-肺叶分割", keywords: ["定期考核记录"] },
    dd_013_05: { title: "肺栓塞分割日常考核", keywords: ["日常考核", "肺栓塞分割日常考核"] },
    dd_013_06: { title: "肺叶分割日常考核", keywords: ["日常考核", "肺叶分割日常考核"] },
    dd_013_07: { title: "肺栓塞分诊日常考核", keywords: ["日常考核", "肺栓塞分诊日常考核"] },
    dd_014: { title: "数据库维护记录", keywords: ["数据库维护记录"] },
    dd_015_01: { title: "原始数据库统计表", keywords: ["原始数据库统计表"] },
    dd_015_02: { title: "基础数据库统计表", keywords: ["基础数据库统计表"] },
    dd_015_03: { title: "标注数据库统计表", keywords: ["标注数据库统计表"] },
    dd_016: { title: "开发环境维护记录说明", keywords: ["开发环境维护记录说明", "数据开发环境"] },
    dd_016_qr: { title: "开发环境维护记录", keywords: ["开发环境维护记录"] },
    dd_017: { title: "标注环境维护记录说明", keywords: ["标注环境维护记录说明"] },
    dd_017_qr: { title: "标注环境维护记录", keywords: ["标注环境维护记录"] },
    dd_eq: { title: "数据设备清单", keywords: ["设备清单"] },
};

/** 数据文件左侧菜单：按工作阶段做二级分组。名称不改。 */
export type DataDocMenuNode = { group: string; key: string; types: string[] };

/** 按算法模块分组的文档类型：一个入口，列表页展示该组下所有模块的文档。 */
export const DATA_DOC_GROUPS: Record<string, { title: string; types: string[] }> = {
    dd_005: { title: "人员培训记录", types: ["dd_005_01", "dd_005_02"] },
    dd_008: { title: "试标注记录", types: ["dd_008_01", "dd_008_02"] },
    dd_009: { title: "数据标注记录", types: ["dd_009_01", "dd_009_02"] },
    dd_013_first: { title: "初次考核记录", types: ["dd_013_01", "dd_013_02"] },
    dd_013_periodic: { title: "定期考核记录", types: ["dd_013_03", "dd_013_04"] },
    dd_013_daily: { title: "日常考核", types: ["dd_013_05", "dd_013_06", "dd_013_07"] },
};

/** 子类型 → 分组 key。 */
export const DATA_DOC_TYPE_GROUP: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    Object.entries(DATA_DOC_GROUPS).forEach(([group, cfg]) => {
        cfg.types.forEach((t) => { map[t] = group; });
    });
    return map;
})();

export const isDataDocGroup = (type?: string) => !!type && type in DATA_DOC_GROUPS;

/** 分组 → 子类型列表。 */
export const getDataDocGroupTypes = (type?: string): string[] =>
    (type && DATA_DOC_GROUPS[type]?.types) || [];

/** 菜单 key / 高亮用：子类型归一到分组 key，其余原样返回。 */
export const getDataDocMenuKey = (type?: string) => DATA_DOC_TYPE_GROUP[type || ""] || type || "";

/** 列表页路径：分组子类型归一到分组入口。 */
export const getDataDocListType = (type?: string) => getDataDocMenuKey(type);

/** 左侧导航显示名称（不带模块名）。分组类型用组标题，其余用文档标题。 */
export const getDataDocNavTitle = (type?: string) => {
    if (!type) return "数据文件";
    if (isDataDocGroup(type)) return DATA_DOC_GROUPS[type].title;
    return DATA_DOC_TYPES[type]?.title || "数据文件";
};

export const DATA_DOC_MENU: DataDocMenuNode[] = [
    {
        group: "规范",
        key: "data_spec",
        types: ["dd_001", "md_003", "md_002_01", "md_002_02", "dd_006", "dd_007"],
    },
    { group: "采集记录", key: "data_collect", types: ["dd_002", "dd_003", "dd_004"] },
    {
        group: "人员记录",
        key: "data_people",
        types: ["dd_005", "dd_013_first", "dd_013_periodic", "dd_013_daily"],
    },
    {
        group: "入库记录",
        key: "data_inbound",
        types: [
            "dd_008", "dd_009", "dd_009_03",
            "dd_011", "dd_010", "dd_012",
        ],
    },
    { group: "数据资产", key: "data_asset", types: ["dd_014", "dd_015_01", "dd_015_02", "dd_015_03"] },
    {
        group: "设备与环境维护",
        key: "data_env",
        types: ["dd_eq", "dd_016", "dd_017"],
    },
];

export const DATA_DOC_TYPE_ORDER = DATA_DOC_MENU.flatMap((item) => item.types);

export const DATA_STATS_IMPORT_TYPES = new Set(["dd_015_01", "dd_015_02", "dd_015_03"]);

/** 记录 / 反馈 / 统计表：无左侧章节，单页原表，导出一张 xlsx。 */
export const DATA_RECORD_DOC_TYPES = new Set([
    "dd_002", "dd_003", "dd_004",
    "dd_005_01", "dd_005_02",
    "dd_008_01", "dd_008_02",
    "dd_009_01", "dd_009_02", "dd_009_03",
    "dd_010", "dd_011", "dd_012",
    "dd_013_01", "dd_013_02", "dd_013_03", "dd_013_04",
    "dd_013_05", "dd_013_06", "dd_013_07",
    "dd_014",
    "dd_015_01", "dd_015_02", "dd_015_03",
    "dd_eq",
]);

export const getDataDocMeta = (type?: string) =>
    DATA_DOC_TYPES[type || ""] || { title: "数据文件", keywords: [] as string[] };
