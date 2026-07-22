import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_stp_doc = async (params: any) => {
    return await httpPost("/trace-api/stp_doc/add_stp_doc", params);
};

export const duplicate_stp_doc = async (params: any) => {
    return await httpGet("/trace-api/stp_doc/duplicate_stp_doc", params);
};

export const update_stp_doc = async (params: any) => {
    return await httpPost("/trace-api/stp_doc/update_stp_doc", params);
};

export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/stp_doc/rebind_product", params);
};

export const delete_stp_doc = async (params: any) => {
    return await httpDelete("/trace-api/stp_doc/delete_stp_doc", params);
};

export const list_stp_doc = async (params: any) => {
    return await httpGet("/trace-api/stp_doc/list_stp_doc", params);
};

export const get_stp_doc = async (params: any) => {
    return await httpGet("/trace-api/stp_doc/get_stp_doc", params);
};

export const export_stp_doc = async (params: any) => {
    return await httpGet("/trace-api/stp_doc/export_stp_doc", params);
};
