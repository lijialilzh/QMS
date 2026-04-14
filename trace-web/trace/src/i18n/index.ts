import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import env from "@/env";

import enUS from "./res/en-US.json";
import zhCN from "./res/zh-CN.json";

export const DEF_LANG = env.DEF_LANG ||"zh-CN";
export const LANGS = {
    "en-US": {
        translation: enUS,
    },
    "zh-CN": {
        translation: zhCN,
    },
};

export const init = (def_lang: string) => {
    i18next.use(initReactI18next).init({
        lng: def_lang,
        resources: LANGS,
    });
};

export { i18next };

const ts = i18next.t;
export default ts;
