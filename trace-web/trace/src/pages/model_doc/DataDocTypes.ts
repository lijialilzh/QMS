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

/** 按章节模块各一份的记录：人员培训 / 试标注 / 标注记录，类型为 dd_00x_m{章节模块id}，规则同肺叶分割那份。 */
export type ModuleRecordGroup = "dd_005" | "dd_008" | "dd_009";
const MODULE_RECORD_RE = /^(dd_005|dd_008|dd_009)_m(\d+)$/;
const MODULE_RECORD_BASE: Record<ModuleRecordGroup, string> = { dd_005: "dd_005_02", dd_008: "dd_008_02", dd_009: "dd_009_02" };
const MODULE_RECORD_SUFFIX: Record<ModuleRecordGroup, string> = { dd_005: "人员培训记录", dd_008: "试标注记录", dd_009: "标注记录" };

export const isModuleRecordGroup = (type?: string): type is ModuleRecordGroup => !!type && type in MODULE_RECORD_BASE;

export const isModuleRecordType = (type?: string) => MODULE_RECORD_RE.test(type || "");

export const moduleRecordGroup = (type?: string): ModuleRecordGroup | "" => {
    const m = MODULE_RECORD_RE.exec(type || "");
    return m ? (m[1] as ModuleRecordGroup) : "";
};

export const moduleRecordChapterId = (type?: string): number => {
    const m = MODULE_RECORD_RE.exec(type || "");
    return m ? Number(m[2]) : 0;
};

export const moduleRecordType = (group: ModuleRecordGroup, chapterId: number) => `${group}_m${chapterId}`;

export const moduleRecordTitle = (group: ModuleRecordGroup, moduleName: string) =>
    `${moduleName}${MODULE_RECORD_SUFFIX[group]}`;

/** 初次/定期/日常考核按章节模块各一份，类型为模板类型_m章节模块id（如 dd_013_02_m8）。 */
export type ExamGroup = "dd_013_first" | "dd_013_periodic" | "dd_013_daily";
const EXAM_RE = /^(dd_013_0[1-7])_m(\d+)$/;

export const isExamGroup = (type?: string): type is ExamGroup =>
    type === "dd_013_first" || type === "dd_013_periodic" || type === "dd_013_daily";

export const isExamModuleType = (type?: string) => EXAM_RE.test(type || "");

export const examModuleChapterId = (type?: string): number => {
    const m = EXAM_RE.exec(type || "");
    return m ? Number(m[2]) : 0;
};

export const examGroupOfType = (type?: string): ExamGroup | "" => {
    const m = EXAM_RE.exec(type || "");
    if (!m) return "";
    return (DATA_DOC_TYPE_GROUP[m[1]] || "") as ExamGroup | "";
};

/** 列表新增时先传分组别名，后端再选定模板类型。 */
export const examAliasType = (group: ExamGroup, chapterId: number) => `${group}_m${chapterId}`;

/** 筛选某一个模块：这一组里每种模板都查一次。 */
export const examModuleQuery = (group: string, chapterId: number) =>
    getDataDocGroupTypes(group).map((base) => `${base}_m${chapterId}`).join(",");

/** 按模块建的记录归到肺叶分割那份的类型（表头、填写规则相同）。考核记录归到它建档时选定的模板。 */
export const baseDataDocType = (type?: string) => {
    const g = moduleRecordGroup(type);
    if (g) return MODULE_RECORD_BASE[g];
    const m = EXAM_RE.exec(type || "");
    return m ? m[1] : (type || "");
};

/** 分组列表查询用：固定子类型 + 按模块建的记录。 */
export const getDataDocGroupQuery = (type?: string): string => {
    const types = getDataDocGroupTypes(type);
    if (isModuleRecordGroup(type)) return [...types, `${type}_m*`].join(",");
    if (isExamGroup(type)) return [...types, ...types.map((base) => `${base}_m*`)].join(",");
    return types.join(",");
};

/** 菜单 key / 高亮用：子类型归一到分组 key，其余原样返回。 */
export const getDataDocMenuKey = (type?: string) =>
    moduleRecordGroup(type) || examGroupOfType(type) || DATA_DOC_TYPE_GROUP[type || ""] || type || "";

/** 列表页路径：分组子类型归一到分组入口。 */
export const getDataDocListType = (type?: string) => getDataDocMenuKey(type);

/** 左侧导航显示名称（不带模块名）。分组类型用组标题，其余用文档标题。 */
export const getDataDocNavTitle = (type?: string) => {
    if (!type) return "数据文件";
    if (isDataDocGroup(type)) return DATA_DOC_GROUPS[type].title;
    const g = moduleRecordGroup(type) || examGroupOfType(type);
    if (g && DATA_DOC_GROUPS[g]) return DATA_DOC_GROUPS[g].title;
    return DATA_DOC_TYPES[type || ""]?.title || "数据文件";
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

export const isDataRecordDocType = (type?: string) =>
    DATA_RECORD_DOC_TYPES.has(type || "") || isModuleRecordType(type) || isExamModuleType(type);

/** 按模块建的记录这里只有通用标题；带模块名的标题在文档封面章节里。 */
export const getDataDocMeta = (type?: string) => {
    const g = moduleRecordGroup(type) || examGroupOfType(type);
    if (g) return { title: DATA_DOC_GROUPS[g].title, keywords: [DATA_DOC_GROUPS[g].title] };
    return DATA_DOC_TYPES[type || ""] || { title: "数据文件", keywords: [] as string[] };
};
