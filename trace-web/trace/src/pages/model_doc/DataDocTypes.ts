export const DATA_DOC_TYPES: Record<string, { title: string; keywords: string[] }> = {
    dd_001: { title: "数据采集需求", keywords: ["数据采集需求"] },
    dd_006: { title: "数据标注质量评估方法", keywords: ["数据标注质量评估方法"] },
    dd_007: { title: "人员考核评价方法", keywords: ["人员考核评价方法"] },
    dd_016: { title: "开发环境维护记录说明", keywords: ["开发环境维护记录说明", "数据开发环境"] },
    dd_017: { title: "标注环境维护记录说明", keywords: ["标注环境维护记录说明"] },
    dd_002: { title: "多中心数据回传记录", keywords: ["多中心数据回传记录", "数据回传"] },
    dd_003: { title: "数据整理记录", keywords: ["数据整理记录"] },
    dd_004: { title: "数据采集需求反馈", keywords: ["数据采集需求反馈"] },
    dd_005_01: { title: "肺栓塞分割人员培训记录", keywords: ["人员培训记录", "肺栓塞分割人员培训"] },
    dd_005_02: { title: "肺叶分割人员培训记录", keywords: ["人员培训记录", "肺叶分割人员培训"] },
    dd_008_01: { title: "肺栓塞分割试标注记录", keywords: ["试标注记录", "肺栓塞分割试标注"] },
    dd_008_02: { title: "肺叶分割试标注记录", keywords: ["试标注记录", "肺叶分割试标注"] },
    dd_009_01: { title: "肺栓塞分割标注记录", keywords: ["数据标注记录", "肺栓塞分割标注记录"] },
    dd_009_02: { title: "肺叶分割标注记录", keywords: ["数据标注记录", "肺叶分割标注记录"] },
    dd_009_03: { title: "肺栓塞分诊标注记录", keywords: ["数据标注记录", "肺栓塞分诊标注记录"] },
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
    dd_016_qr: { title: "开发环境维护记录", keywords: ["开发环境维护记录"] },
    dd_017_qr: { title: "标注环境维护记录", keywords: ["标注环境维护记录"] },
    dd_eq: { title: "数据设备清单", keywords: ["设备清单"] },
};

export const DATA_DOC_TYPE_ORDER = Object.keys(DATA_DOC_TYPES);

export const DATA_STATS_IMPORT_TYPES = new Set(["dd_015_01", "dd_015_02", "dd_015_03"]);

export const getDataDocMeta = (type?: string) =>
    DATA_DOC_TYPES[type || ""] || { title: "数据文件", keywords: [] as string[] };
