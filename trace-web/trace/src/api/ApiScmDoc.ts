import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_scm_doc = async (params: any) => {
    return await httpPost("/trace-api/scm_doc/add_scm_doc", params);
};

export const duplicate_scm_doc = async (params: any) => {
    return await httpGet("/trace-api/scm_doc/duplicate_scm_doc", params);
};

export const update_scm_doc = async (params: any) => {
    return await httpPost("/trace-api/scm_doc/update_scm_doc", params);
};

export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/scm_doc/rebind_product", params);
};

export const delete_scm_doc = async (params: any) => {
    return await httpDelete("/trace-api/scm_doc/delete_scm_doc", params);
};

export const list_scm_doc = async (params: any) => {
    return await httpGet("/trace-api/scm_doc/list_scm_doc", params);
};

export const get_scm_doc = async (params: any) => {
    return await httpGet("/trace-api/scm_doc/get_scm_doc", params);
};

export const export_scm_doc = async (params: any) => {
    return await httpGet("/trace-api/scm_doc/export_scm_doc", params);
};
