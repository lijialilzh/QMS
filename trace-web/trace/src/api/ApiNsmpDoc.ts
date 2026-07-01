import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_nsmp_doc = async (params: any) => {
    return await httpPost("/trace-api/nsmp_doc/add_nsmp_doc", params);
};

export const duplicate_nsmp_doc = async (params: any) => {
    return await httpGet("/trace-api/nsmp_doc/duplicate_nsmp_doc", params);
};

export const update_nsmp_doc = async (params: any) => {
    return await httpPost("/trace-api/nsmp_doc/update_nsmp_doc", params);
};

export const delete_nsmp_doc = async (params: any) => {
    return await httpDelete("/trace-api/nsmp_doc/delete_nsmp_doc", params);
};

export const list_nsmp_doc = async (params: any) => {
    return await httpGet("/trace-api/nsmp_doc/list_nsmp_doc", params);
};

export const get_nsmp_doc = async (params: any) => {
    return await httpGet("/trace-api/nsmp_doc/get_nsmp_doc", params);
};

export const nsmp_autofill = async (params: any) => {
    return await httpGet("/trace-api/nsmp_doc/nsmp_autofill", params);
};

export const export_nsmp_doc = async (params: any) => {
    return await httpGet("/trace-api/nsmp_doc/export_nsmp_doc", params);
};
