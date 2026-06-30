import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const nsr_autofill = async (params: any) => {
    return await httpGet("/trace-api/nsr_doc/nsr_autofill", { ...params, _t: Date.now() });
};

export const add_nsr_doc = async (params: any) => {
    return await httpPost("/trace-api/nsr_doc/add_nsr_doc", params);
};

export const duplicate_nsr_doc = async (params: any) => {
    return await httpGet("/trace-api/nsr_doc/duplicate_nsr_doc", params);
};

export const update_nsr_doc = async (params: any) => {
    return await httpPost("/trace-api/nsr_doc/update_nsr_doc", params);
};

export const delete_nsr_doc = async (params: any) => {
    return await httpDelete("/trace-api/nsr_doc/delete_nsr_doc", params);
};

export const list_nsr_doc = async (params: any) => {
    return await httpGet("/trace-api/nsr_doc/list_nsr_doc", params);
};

export const get_nsr_doc = async (params: any) => {
    return await httpGet("/trace-api/nsr_doc/get_nsr_doc", { ...params, _t: Date.now() });
};

export const export_nsr_doc = async (params: any) => {
    return await httpGet("/trace-api/nsr_doc/export_nsr_doc", { ...params, _t: Date.now() });
};
