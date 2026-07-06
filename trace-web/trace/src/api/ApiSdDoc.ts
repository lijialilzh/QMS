import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_sd_doc = async (params: any) => {
    return await httpPost("/trace-api/sd_doc/add_sd_doc", params);
};

export const duplicate_sd_doc = async (params: any) => {
    return await httpGet("/trace-api/sd_doc/duplicate_sd_doc", params);
};

export const update_sd_doc = async (params: any) => {
    return await httpPost("/trace-api/sd_doc/update_sd_doc", params);
};

export const delete_sd_doc = async (params: any) => {
    return await httpDelete("/trace-api/sd_doc/delete_sd_doc", params);
};

export const list_sd_doc = async (params: any) => {
    return await httpGet("/trace-api/sd_doc/list_sd_doc", params);
};

export const get_sd_doc = async (params: any) => {
    return await httpGet("/trace-api/sd_doc/get_sd_doc", params);
};

export const export_sd_doc = async (params: any) => {
    return await httpGet("/trace-api/sd_doc/export_sd_doc", params);
};
