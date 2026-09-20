import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";

const unwrapLocale = (loc: any) => {
    if (!loc) return loc;
    if (loc.Popconfirm || loc.Modal) return loc;
    if (loc.default && (loc.default.Popconfirm || loc.default.Modal)) return loc.default;
    return loc;
};

const ZH = unwrapLocale(zhCN);
const EN = unwrapLocale(enUS);

export const ANT_LOCALES = {
    "zh-CN": ZH,
    "zh": ZH,
    "en-US": EN,
    "en": EN,
} as any;

export const getAntLocale = (lang?: string) => {
    const raw = String(lang || "zh-CN").replace(/_/g, "-");
    return ANT_LOCALES[raw] || ANT_LOCALES[raw.split("-")[0]] || ZH;
};
