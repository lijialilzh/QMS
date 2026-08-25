import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_model_doc = async (params: any) => {
    return await httpPost("/trace-api/model_doc/add_model_doc", params);
};

export const duplicate_model_doc = async (params: any) => {
    return await httpGet("/trace-api/model_doc/duplicate_model_doc", params);
};

export const update_model_doc = async (params: any) => {
    return await httpPost("/trace-api/model_doc/update_model_doc", params);
};

export const delete_model_doc = async (params: any) => {
    return await httpDelete("/trace-api/model_doc/delete_model_doc", params);
};

export const list_model_doc = async (params: any) => {
    return await httpGet("/trace-api/model_doc/list_model_doc", params);
};

export const get_model_doc = async (params: any) => {
    return await httpGet("/trace-api/model_doc/get_model_doc", params);
};

export const export_model_doc = async (params: any) => {
    return await httpGet("/trace-api/model_doc/export_model_doc", params);
};
