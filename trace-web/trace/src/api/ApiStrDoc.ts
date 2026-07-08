import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_str_doc = async (params: any) => {
    return await httpPost("/trace-api/str_doc/add_str_doc", params);
};

export const duplicate_str_doc = async (params: any) => {
    return await httpGet("/trace-api/str_doc/duplicate_str_doc", params);
};

export const update_str_doc = async (params: any) => {
    return await httpPost("/trace-api/str_doc/update_str_doc", params);
};

export const delete_str_doc = async (params: any) => {
    return await httpDelete("/trace-api/str_doc/delete_str_doc", params);
};

export const list_str_doc = async (params: any) => {
    return await httpGet("/trace-api/str_doc/list_str_doc", params);
};

export const get_str_doc = async (params: any) => {
    return await httpGet("/trace-api/str_doc/get_str_doc", params);
};

export const export_str_doc = async (params: any) => {
    return await httpGet("/trace-api/str_doc/export_str_doc", params);
};
