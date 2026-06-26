import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_ptr_doc = async (params: any) => {
    return await httpPost("/trace-api/ptr_doc/add_ptr_doc", params);
};

export const duplicate_ptr_doc = async (params: any) => {
    return await httpGet("/trace-api/ptr_doc/duplicate_ptr_doc", params);
};

export const update_ptr_doc = async (params: any) => {
    return await httpPost("/trace-api/ptr_doc/update_ptr_doc", params);
};

export const delete_ptr_doc = async (params: any) => {
    return await httpDelete("/trace-api/ptr_doc/delete_ptr_doc", params);
};

export const list_ptr_doc = async (params: any) => {
    return await httpGet("/trace-api/ptr_doc/list_ptr_doc", params);
};

export const get_ptr_doc = async (params: any) => {
    return await httpGet("/trace-api/ptr_doc/get_ptr_doc", params);
};

export const export_ptr_doc = async (params: any) => {
    return await httpGet("/trace-api/ptr_doc/export_ptr_doc", params);
};
