import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_pha_doc = async (params: any) => {
    return await httpPost("/trace-api/pha_doc/add_pha_doc", params);
};

export const duplicate_pha_doc = async (params: any) => {
    return await httpGet("/trace-api/pha_doc/duplicate_pha_doc", params);
};

export const update_pha_doc = async (params: any) => {
    return await httpPost("/trace-api/pha_doc/update_pha_doc", params);
};

export const delete_pha_doc = async (params: any) => {
    return await httpDelete("/trace-api/pha_doc/delete_pha_doc", params);
};

export const list_pha_doc = async (params: any) => {
    return await httpGet("/trace-api/pha_doc/list_pha_doc", params);
};

export const get_pha_doc = async (params: any) => {
    return await httpGet("/trace-api/pha_doc/get_pha_doc", params);
};

export const export_pha_doc = async (params: any) => {
    return await httpGet("/trace-api/pha_doc/export_pha_doc", { ...params, _t: Date.now() });
};
