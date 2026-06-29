import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const cyber_cap_schema = async () => {
    return await httpGet("/trace-api/cyber_cap_doc/cyber_cap_schema", { _t: Date.now() });
};

export const cyber_cap_autofill = async (params: any) => {
    return await httpGet("/trace-api/cyber_cap_doc/cyber_cap_autofill", { ...params, _t: Date.now() });
};

export const add_cyber_cap_doc = async (params: any) => {
    return await httpPost("/trace-api/cyber_cap_doc/add_cyber_cap_doc", params);
};

export const duplicate_cyber_cap_doc = async (params: any) => {
    return await httpGet("/trace-api/cyber_cap_doc/duplicate_cyber_cap_doc", params);
};

export const update_cyber_cap_doc = async (params: any) => {
    return await httpPost("/trace-api/cyber_cap_doc/update_cyber_cap_doc", params);
};

export const delete_cyber_cap_doc = async (params: any) => {
    return await httpDelete("/trace-api/cyber_cap_doc/delete_cyber_cap_doc", params);
};

export const list_cyber_cap_doc = async (params: any) => {
    return await httpGet("/trace-api/cyber_cap_doc/list_cyber_cap_doc", params);
};

export const get_cyber_cap_doc = async (params: any) => {
    return await httpGet("/trace-api/cyber_cap_doc/get_cyber_cap_doc", { ...params, _t: Date.now() });
};

export const export_cyber_cap_doc = async (params: any) => {
    return await httpGet("/trace-api/cyber_cap_doc/export_cyber_cap_doc", { ...params, _t: Date.now() });
};
