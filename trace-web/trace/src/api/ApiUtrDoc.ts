import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_utr_doc = async (params: any) => {
    return await httpPost("/trace-api/utr_doc/add_utr_doc", params);
};

export const duplicate_utr_doc = async (params: any) => {
    return await httpGet("/trace-api/utr_doc/duplicate_utr_doc", params);
};

export const update_utr_doc = async (params: any) => {
    return await httpPost("/trace-api/utr_doc/update_utr_doc", params);
};

export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/utr_doc/rebind_product", params);
};

export const delete_utr_doc = async (params: any) => {
    return await httpDelete("/trace-api/utr_doc/delete_utr_doc", params);
};

export const list_utr_doc = async (params: any) => {
    return await httpGet("/trace-api/utr_doc/list_utr_doc", params);
};

export const get_utr_doc = async (params: any) => {
    return await httpGet("/trace-api/utr_doc/get_utr_doc", params);
};

export const export_utr_doc = async (params: any) => {
    return await httpGet("/trace-api/utr_doc/export_utr_doc", params);
};
