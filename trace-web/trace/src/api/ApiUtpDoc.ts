import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_utp_doc = async (params: any) => {
    return await httpPost("/trace-api/utp_doc/add_utp_doc", params);
};

export const duplicate_utp_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_doc/duplicate_utp_doc", params);
};

export const update_utp_doc = async (params: any) => {
    return await httpPost("/trace-api/utp_doc/update_utp_doc", params);
};

export const delete_utp_doc = async (params: any) => {
    return await httpDelete("/trace-api/utp_doc/delete_utp_doc", params);
};

export const list_utp_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_doc/list_utp_doc", params);
};

export const get_utp_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_doc/get_utp_doc", params);
};

export const export_utp_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_doc/export_utp_doc", params);
};
