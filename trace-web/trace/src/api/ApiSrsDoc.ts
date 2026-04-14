import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_doc_file = async (params: FormData | Record<string, unknown>) => {
    const body = params instanceof FormData ? params : params2form(params);
    return await httpPost("/trace-api/srs_doc/add_doc_file", body);
};

export const add_srs_doc = async (params: any) => {
    return await httpPost("/trace-api/srs_doc/add_srs_doc", params);
};

export const duplicate_srs_doc = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/duplicate_srs_doc", params)
}

export const delete_srs_doc = async (params: any) => {
    return await httpDelete("/trace-api/srs_doc/delete_srs_doc", params);
};

export const update_srs_doc = async (params: any) => {
    return await httpPost("/trace-api/srs_doc/update_srs_doc", params);
};

export const delete_srs_node = async (params: any) => {
    return await httpDelete("/trace-api/srs_doc/delete_srs_node", params);
};

export const list_srs_doc = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/list_srs_doc", params);
};

export const get_srs_doc = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/get_srs_doc", params);
};

export const export_srs_doc = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/export_srs_doc", params);
};

export const list_doc_trace = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/list_doc_trace", params);
};

export const export_doc_trace = async (params: any) => {
    return await httpGet("/trace-api/srs_doc/export_doc_trace", params);
};

export const import_srs_doc_word = async (params: any) => {
    return await httpPost("/trace-api/srs_doc/import_srs_doc_word", params2form(params));
};
