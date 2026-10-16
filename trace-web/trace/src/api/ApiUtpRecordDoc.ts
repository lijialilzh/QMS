import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_utp_record_doc = async (params: any) => {
    return await httpPost("/trace-api/utp_record_doc/add_utp_record_doc", params);
};

export const duplicate_utp_record_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_record_doc/duplicate_utp_record_doc", params);
};

export const update_utp_record_doc = async (params: any) => {
    return await httpPost("/trace-api/utp_record_doc/update_utp_record_doc", params);
};

export const rebind_product = async (params: any) => {
    return await httpGet("/trace-api/utp_record_doc/rebind_product", params);
};

export const delete_utp_record_doc = async (params: any) => {
    return await httpDelete("/trace-api/utp_record_doc/delete_utp_record_doc", params);
};

export const list_utp_record_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_record_doc/list_utp_record_doc", params);
};

export const get_utp_record_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_record_doc/get_utp_record_doc", params);
};

export const export_utp_record_doc = async (params: any) => {
    return await httpGet("/trace-api/utp_record_doc/export_utp_record_doc", params);
};
