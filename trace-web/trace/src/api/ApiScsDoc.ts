import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_scs_doc = async (params: any) => {
    return await httpPost("/trace-api/scs_doc/add_scs_doc", params);
};

export const duplicate_scs_doc = async (params: any) => {
    return await httpGet("/trace-api/scs_doc/duplicate_scs_doc", params);
};

export const update_scs_doc = async (params: any) => {
    return await httpPost("/trace-api/scs_doc/update_scs_doc", params);
};

export const delete_scs_doc = async (params: any) => {
    return await httpDelete("/trace-api/scs_doc/delete_scs_doc", params);
};

export const list_scs_doc = async (params: any) => {
    return await httpGet("/trace-api/scs_doc/list_scs_doc", params);
};

export const get_scs_doc = async (params: any) => {
    return await httpGet("/trace-api/scs_doc/get_scs_doc", params);
};

export const export_scs_doc = async (params: any) => {
    return await httpGet("/trace-api/scs_doc/export_scs_doc", params);
};
