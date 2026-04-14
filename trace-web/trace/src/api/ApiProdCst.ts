import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_csts = async (params: any) => {
    return await httpPost("/trace-api/prod_cst/add_prod_csts", params);
};

export const update_prod_cst = async (params: any) => {
    return await httpPost("/trace-api/prod_cst/update_prod_cst", params);
};

export const delete_prod_csts = async (params: any) => {
    return await httpDelete("/trace-api/prod_cst/delete_prod_csts", params);
};

export const list_prod_cst = async (params: any) => {
    return await httpGet("/trace-api/prod_cst/list_prod_cst", params);
};

export const export_prod_csts = async (params: any) => {
    return await httpGet("/trace-api/prod_cst/export_prod_csts", params);
};
