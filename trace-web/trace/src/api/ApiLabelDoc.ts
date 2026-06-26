import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_label_doc = async (params: any) => {
    return await httpPost("/trace-api/label_doc/add_label_doc", params);
};

export const duplicate_label_doc = async (params: any) => {
    return await httpGet("/trace-api/label_doc/duplicate_label_doc", params);
};

export const update_label_doc = async (params: any) => {
    return await httpPost("/trace-api/label_doc/update_label_doc", params);
};

export const delete_label_doc = async (params: any) => {
    return await httpDelete("/trace-api/label_doc/delete_label_doc", params);
};

export const list_label_doc = async (params: any) => {
    return await httpGet("/trace-api/label_doc/list_label_doc", params);
};

export const get_label_doc = async (params: any) => {
    return await httpGet("/trace-api/label_doc/get_label_doc", params);
};

export const export_label_doc = async (params: any) => {
    return await httpGet("/trace-api/label_doc/export_label_doc", params);
};
