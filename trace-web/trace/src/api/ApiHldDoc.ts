import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_doc_file = async (params: FormData | Record<string, unknown>) => {
    const body = params instanceof FormData ? params : params2form(params);
    return await httpPost("/trace-api/hld_doc/add_doc_file", body);
};

export const add_hld_doc = async (params: any) => {
    return await httpPost("/trace-api/hld_doc/add_hld_doc", params);
};

export const duplicate_hld_doc = async (params: any) => {
    return await httpGet("/trace-api/hld_doc/duplicate_hld_doc", params);
};

export const delete_hld_doc = async (params: any) => {
    return await httpDelete("/trace-api/hld_doc/delete_hld_doc", params);
};

export const update_hld_doc = async (params: any) => {
    return await httpPost("/trace-api/hld_doc/update_hld_doc", params);
};

export const update_hld_doc_file_no = async (params: { id: number; file_no: string }) => {
    return await httpPost("/trace-api/hld_doc/update_hld_doc_file_no", params2form(params));
};

export const delete_hld_node = async (params: any) => {
    return await httpDelete("/trace-api/hld_doc/delete_hld_node", params);
};

export const list_hld_doc = async (params: any) => {
    return await httpGet("/trace-api/hld_doc/list_hld_doc", params);
};

export const get_hld_doc = async (params: any) => {
    return await httpGet("/trace-api/hld_doc/get_hld_doc", params);
};

export const sync_hld_from_sds = async (params: { product_id: number; version: string }) => {
    return await httpGet("/trace-api/hld_doc/sync_hld_from_sds", params);
};

export const export_hld_doc = async (params: any) => {
    return await httpGet("/trace-api/hld_doc/export_hld_doc", params);
};

export const import_hld_doc_word = async (params: any) => {
    return await httpPost("/trace-api/hld_doc/import_hld_doc_word", params2form(params));
};
