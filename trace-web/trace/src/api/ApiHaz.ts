import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_haz = async (params: any) => {
    return await httpPost("/trace-api/haz/add_haz", params);
};

export const delete_haz = async (params: any) => {
    return await httpDelete("/trace-api/haz/delete_haz", params);
};

export const update_haz = async (params: any) => {
    return await httpPost("/trace-api/haz/update_haz", params);
};

export const list_haz = async (params: any) => {
    return await httpGet("/trace-api/haz/list_haz", params);
};

export const get_haz = async (params: any) => {
    return await httpGet("/trace-api/haz/get_haz", params);
};

export const export_hazs = async (params: any) => {
    return await httpGet("/trace-api/haz/export_hazs", params);
};

export const import_hazs = async (params: any) => {
    return await httpPost("/trace-api/haz/import_hazs", params2form(params));
};
