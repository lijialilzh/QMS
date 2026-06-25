import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_pdp_doc = async (params: any) => {
    return await httpPost("/trace-api/pdp_doc/add_pdp_doc", params);
};

export const duplicate_pdp_doc = async (params: any) => {
    return await httpGet("/trace-api/pdp_doc/duplicate_pdp_doc", params);
};

export const update_pdp_doc = async (params: any) => {
    return await httpPost("/trace-api/pdp_doc/update_pdp_doc", params);
};

export const delete_pdp_doc = async (params: any) => {
    return await httpDelete("/trace-api/pdp_doc/delete_pdp_doc", params);
};

export const list_pdp_doc = async (params: any) => {
    return await httpGet("/trace-api/pdp_doc/list_pdp_doc", params);
};

export const get_pdp_doc = async (params: any) => {
    return await httpGet("/trace-api/pdp_doc/get_pdp_doc", params);
};

export const export_pdp_doc = async (params: any) => {
    return await httpGet("/trace-api/pdp_doc/export_pdp_doc", params);
};
