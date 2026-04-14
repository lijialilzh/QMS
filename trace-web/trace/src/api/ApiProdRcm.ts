import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_rcms = async (params: any) => {
    return await httpPost("/trace-api/prod_rcm/add_prod_rcms", params);
};

export const delete_prod_rcms = async (params: any) => {
    return await httpDelete("/trace-api/prod_rcm/delete_prod_rcms", params);
};

export const list_prod_rcm = async (params: any) => {
    return await httpGet("/trace-api/prod_rcm/list_prod_rcm", params);
};

export const export_prod_rcms = async (params: any) => {
    return await httpGet("/trace-api/prod_rcm/export_prod_rcms", params);
};
