import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_cst = async (params: any) => {
    return await httpPost("/trace-api/cst/add_cst", params);
};

export const delete_cst = async (params: any) => {
    return await httpDelete("/trace-api/cst/delete_cst", params);
};

export const update_cst = async (params: any) => {
    return await httpPost("/trace-api/cst/update_cst", params);
};

export const list_cst = async (params: any) => {
    return await httpGet("/trace-api/cst/list_cst", params);
};

export const get_cst = async (params: any) => {
    return await httpGet("/trace-api/cst/get_cst", params);
};

export const export_csts = async (params: any) => {
    return await httpGet("/trace-api/cst/export_csts", params);
};

export const import_csts = async (params: any) => {
    return await httpPost("/trace-api/cst/import_csts", params2form(params));
};
