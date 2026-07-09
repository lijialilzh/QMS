import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_teq_doc = async (params: any) => {
    return await httpPost("/trace-api/teq_doc/add_teq_doc", params);
};

export const duplicate_teq_doc = async (params: any) => {
    return await httpGet("/trace-api/teq_doc/duplicate_teq_doc", params);
};

export const update_teq_doc = async (params: any) => {
    return await httpPost("/trace-api/teq_doc/update_teq_doc", params);
};

export const delete_teq_doc = async (params: any) => {
    return await httpDelete("/trace-api/teq_doc/delete_teq_doc", params);
};

export const list_teq_doc = async (params: any) => {
    return await httpGet("/trace-api/teq_doc/list_teq_doc", params);
};

export const get_teq_doc = async (params: any) => {
    return await httpGet("/trace-api/teq_doc/get_teq_doc", params);
};

export const export_teq_doc = async (params: any) => {
    return await httpGet("/trace-api/teq_doc/export_teq_doc", params);
};