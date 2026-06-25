import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_vuh_doc = async (params: any) => {
    return await httpPost("/trace-api/vuh_doc/add_vuh_doc", params);
};

export const duplicate_vuh_doc = async (params: any) => {
    return await httpGet("/trace-api/vuh_doc/duplicate_vuh_doc", params);
};

export const update_vuh_doc = async (params: any) => {
    return await httpPost("/trace-api/vuh_doc/update_vuh_doc", params);
};

export const delete_vuh_doc = async (params: any) => {
    return await httpDelete("/trace-api/vuh_doc/delete_vuh_doc", params);
};

export const list_vuh_doc = async (params: any) => {
    return await httpGet("/trace-api/vuh_doc/list_vuh_doc", params);
};

export const get_vuh_doc = async (params: any) => {
    return await httpGet("/trace-api/vuh_doc/get_vuh_doc", params);
};

export const export_vuh_doc = async (params: any) => {
    return await httpGet("/trace-api/vuh_doc/export_vuh_doc", params);
};
