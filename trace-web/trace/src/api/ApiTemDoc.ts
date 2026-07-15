import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_tem_doc = async (params: any) => {
    return await httpPost("/trace-api/tem_doc/add_tem_doc", params);
};

export const duplicate_tem_doc = async (params: any) => {
    return await httpGet("/trace-api/tem_doc/duplicate_tem_doc", params);
};

export const update_tem_doc = async (params: any) => {
    return await httpPost("/trace-api/tem_doc/update_tem_doc", params);
};

export const delete_tem_doc = async (params: any) => {
    return await httpDelete("/trace-api/tem_doc/delete_tem_doc", params);
};

export const list_tem_doc = async (params: any) => {
    return await httpGet("/trace-api/tem_doc/list_tem_doc", params);
};

export const get_tem_doc = async (params: any) => {
    return await httpGet("/trace-api/tem_doc/get_tem_doc", params);
};

export const export_tem_doc = async (params: any) => {
    return await httpGet("/trace-api/tem_doc/export_tem_doc", params);
};

export const refresh_content = async (params: any) => {
    return await httpGet("/trace-api/tem_doc/refresh_content", params);
};