import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_hazs = async (params: any) => {
    return await httpPost("/trace-api/prod_haz/add_prod_hazs", params);
};

export const update_prod_haz = async (params: any) => {
    return await httpPost("/trace-api/prod_haz/update_prod_haz", params);
};

export const delete_prod_hazs = async (params: any) => {
    return await httpDelete("/trace-api/prod_haz/delete_prod_hazs", params);
};

export const list_prod_haz = async (params: any) => {
    return await httpGet("/trace-api/prod_haz/list_prod_haz", params);
};

export const export_prod_hazs = async (params: any) => {
    return await httpGet("/trace-api/prod_haz/export_prod_hazs", params);
};
