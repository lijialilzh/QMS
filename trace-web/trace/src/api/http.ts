export const C_OK = 1;
export const C_ERR_AUTH = -2;
import ts, { i18next, DEF_LANG } from "../i18n";

export const params2form = (params: any) => {
    const formData = new FormData();
    Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value && value.fileList) {
            value.fileList.forEach((file: any) => {
                formData.append(key, file.originFileObj || file);
            });
        } else if (value) {
            formData.append(key, value);
        }
    });
    return formData;
};

const process = async (resp: any) => {
    const ERR = { msg: ts("msg_req_fail") };
    if (resp.ok) {
        try {
            const contentType = resp.headers.get("content-type");
            const isDownload =
                !!contentType &&
                (
                    contentType.startsWith("application/octet-stream") ||
                    contentType.includes("application/vnd.openxmlformats-officedocument")
                );
            if (isDownload) {
                const cd = resp.headers.get("content-disposition") || "";
                const filenameStar = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
                const filenameRaw = cd.match(/filename=([^;]+)/i)?.[1];
                const filename = (filenameStar || filenameRaw || "").replace(/^"|"$/g, "");
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = decodeURIComponent(filename || "unknown");
                a.click();
                URL.revokeObjectURL(url);
                return { code: C_OK, msg: ts("msg_ok") };
            } else {
                const res = await resp.json();
                if (res.code === C_ERR_AUTH) {
                    const ctxPath = new URL(window.location.href).pathname;
                    window.location.replace(`${ctxPath}#/login`);
                }
                return res;
            }
        } catch (err) {
            console.error(err);
            return ERR;
        }
    } else {
        console.warn(resp);
        return ERR;
    }
};

const joinUrl = (url: string, params?: any) => {
    const obj = (params || {}) as any;
    const pairs = [] as any;
    Object.keys(obj).forEach((key) => {
        const value = encodeURIComponent(obj[key] == null ? "" : obj[key]);
        if (value) {
            pairs.push(`${key}=${value}`);
        }
    });
    if (pairs.length === 0) {
        return url;
    } else if (url.search(/\?/) >= 0) {
        return url + "&" + pairs.join("&");
    } else {
        return url + "?" + pairs.join("&");
    }
};

export const httpGet = async (url: string, params?: any) => {
    const headers = { "x-lang": i18next.language || DEF_LANG };
    return await fetch(joinUrl(url, params), { headers }).then(process);
};

export const httpPost = async (url: string, params?: any) => {
    if (params instanceof FormData) {
        const headers = { "x-lang": i18next.language || DEF_LANG };
        return await fetch(url, { method: "POST", headers, body: params }).then(process);
    }
    const headers = { "x-lang": i18next.language || DEF_LANG, "content-type": "application/json;charset=utf-8" };
    return await fetch(url, { method: "POST", headers, body: params ? JSON.stringify(params) : null }).then(process);
};

export const httpDelete = async (url: string, params?: any) => {
    const headers = { "x-lang": i18next.language || DEF_LANG };
    return await fetch(joinUrl(url, params), { method: "DELETE", headers }).then(process);
};
