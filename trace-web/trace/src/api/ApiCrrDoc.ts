import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_crr_doc = async (params: any) => {
    return await httpPost("/trace-api/crr_doc/add_crr_doc", params);
};

export const duplicate_crr_doc = async (params: any) => {
    return await httpGet("/trace-api/crr_doc/duplicate_crr_doc", params);
};

export const update_crr_doc = async (params: any) => {
    return await httpPost("/trace-api/crr_doc/update_crr_doc", params);
};

export const delete_crr_doc = async (params: any) => {
    return await httpDelete("/trace-api/crr_doc/delete_crr_doc", params);
};

export const list_crr_doc = async (params: any) => {
    return await httpGet("/trace-api/crr_doc/list_crr_doc", params);
};

export const get_crr_doc = async (params: any) => {
    return await httpGet("/trace-api/crr_doc/get_crr_doc", params);
};

export const export_crr_doc = async (params: any) => {
    return await httpGet("/trace-api/crr_doc/export_crr_doc", params);
};
