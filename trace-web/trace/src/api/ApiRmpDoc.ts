import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_rmp_doc = async (params: any) => {
    return await httpPost("/trace-api/rmp_doc/add_rmp_doc", params);
};

export const duplicate_rmp_doc = async (params: any) => {
    return await httpGet("/trace-api/rmp_doc/duplicate_rmp_doc", params);
};

export const update_rmp_doc = async (params: any) => {
    return await httpPost("/trace-api/rmp_doc/update_rmp_doc", params);
};

export const delete_rmp_doc = async (params: any) => {
    return await httpDelete("/trace-api/rmp_doc/delete_rmp_doc", params);
};

export const list_rmp_doc = async (params: any) => {
    return await httpGet("/trace-api/rmp_doc/list_rmp_doc", params);
};

export const get_rmp_doc = async (params: any) => {
    return await httpGet("/trace-api/rmp_doc/get_rmp_doc", params);
};

export const rmp_autofill = async (params: any) => {
    return await httpGet("/trace-api/rmp_doc/rmp_autofill", params);
};

export const export_rmp_doc = async (params: any) => {
    return await httpGet("/trace-api/rmp_doc/export_rmp_doc", params);
};
