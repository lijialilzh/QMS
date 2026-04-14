import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_doc_file = async (params: FormData | Record<string, unknown>) => {
    const body = params instanceof FormData ? params : params2form(params);
    return await httpPost("/trace-api/sds_doc/add_doc_file", body);
};

export const add_sds_doc = async (params: any) => {
    return await httpPost("/trace-api/sds_doc/add_sds_doc", params);
};

export const duplicate_sds_doc = async (params: any) => {
    return await httpGet("/trace-api/sds_doc/duplicate_sds_doc", params)
}

export const delete_sds_doc = async (params: any) => {
    return await httpDelete("/trace-api/sds_doc/delete_sds_doc", params);
};

export const update_sds_doc = async (params: any) => {
    return await httpPost("/trace-api/sds_doc/update_sds_doc", params);
};

export const delete_sds_node = async (params: any) => {
    return await httpDelete("/trace-api/sds_doc/delete_sds_node", params);
};

export const list_sds_doc = async (params: any) => {
    return await httpGet("/trace-api/sds_doc/list_sds_doc", params);
};

export const get_sds_doc = async (params: any) => {
    return await httpGet("/trace-api/sds_doc/get_sds_doc", params);
};

export const export_sds_doc = async (params: any) => {
    return await httpGet("/trace-api/sds_doc/export_sds_doc", params);
};

export const compare_sds_doc = async (params: { id0: number; id1: number }) => {
    return await httpGet("/trace-api/sds_doc/compare_sds_doc", params);
};
