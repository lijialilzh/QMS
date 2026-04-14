import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_rcm = async (params: any) => {
    return await httpPost("/trace-api/rcm/add_rcm", params);
};

export const delete_rcm = async (params: any) => {
    return await httpDelete("/trace-api/rcm/delete_rcm", params);
};

export const update_rcm = async (params: any) => {
    return await httpPost("/trace-api/rcm/update_rcm", params);
};

export const list_rcm = async (params: any) => {
    return await httpGet("/trace-api/rcm/list_rcm", params);
};

export const get_rcm = async (params: any) => {
    return await httpGet("/trace-api/rcm/get_rcm", params);
};

export const export_rcms = async (params: any) => {
    return await httpGet("/trace-api/rcm/export_rcms", params);
};

export const import_rcms = async (params: any) => {
    return await httpPost("/trace-api/rcm/import_rcms", params2form(params));
};
