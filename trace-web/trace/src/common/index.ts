import dayjs from "dayjs";
import { useReducer } from "react";

export const rateStr = (rate: number) => {
    rate = Math.round((rate || 0.0) * 100);
    return `${rate}%`;
};

export const reducer = (data: any, action: any) => {
    return { ...data, ...action };
};

export const useData = (action: any) => {
    return useReducer(reducer, action);
};

export const fixUrl = (url: string) => {
    return `/${url}`.replace(/\/+/, "/");
};

export const file2base64 = (file: any): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

export const basename = (path: string) => {
    return (path || "").match(/[^\/]+/g)?.pop();
};

export const parseDate = (datestr: string, fbNow?: any) => {
    if (fbNow) {
        return dayjs(datestr || new Date());
    } else if (datestr) {
        return dayjs(datestr);
    }
};

export const numberToChinese = (num: number): string => {
    const chinese = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (num <= 10) return chinese[num - 1];
    return num.toString();
};

export { renderOneLineWithTooltip } from "./tableRenderers";
