import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_deq_doc = async (params: any) => {
    return await httpPost("/trace-api/deq_doc/add_deq_doc", params);
};

export const duplicate_deq_doc = async (params: any) => {
    return await httpGet("/trace-api/deq_doc/duplicate_deq_doc", params);
};

export const update_deq_doc = async (params: any) => {
    return await httpPost("/trace-api/deq_doc/update_deq_doc", params);
};

export const delete_deq_doc = async (params: any) => {
    return await httpDelete("/trace-api/deq_doc/delete_deq_doc", params);
};

export const list_deq_doc = async (params: any) => {
    return await httpGet("/trace-api/deq_doc/list_deq_doc", params);
};

export const get_deq_doc = async (params: any) => {
    return await httpGet("/trace-api/deq_doc/get_deq_doc", params);
};

export const export_deq_doc = async (params: any) => {
    return await httpGet("/trace-api/deq_doc/export_deq_doc", params);
};
