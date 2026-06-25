import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_pir_doc = async (params: any) => {
    return await httpPost("/trace-api/pir_doc/add_pir_doc", params);
};

export const duplicate_pir_doc = async (params: any) => {
    return await httpGet("/trace-api/pir_doc/duplicate_pir_doc", params);
};

export const update_pir_doc = async (params: any) => {
    return await httpPost("/trace-api/pir_doc/update_pir_doc", params);
};

export const delete_pir_doc = async (params: any) => {
    return await httpDelete("/trace-api/pir_doc/delete_pir_doc", params);
};

export const list_pir_doc = async (params: any) => {
    return await httpGet("/trace-api/pir_doc/list_pir_doc", params);
};

export const get_pir_doc = async (params: any) => {
    return await httpGet("/trace-api/pir_doc/get_pir_doc", params);
};

export const export_pir_doc = async (params: any) => {
    return await httpGet("/trace-api/pir_doc/export_pir_doc", params);
};
