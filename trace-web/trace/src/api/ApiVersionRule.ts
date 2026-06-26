import { httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const get_version_rule = async () => {
    return await httpGet("/trace-api/version_rule/get_version_rule", {});
};

export const save_version_rule = async (params: any) => {
    return await httpPost("/trace-api/version_rule/save_version_rule", params);
};
