import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_prod_dhf = async (params: any) => {
    return await httpPost("/trace-api/prod_dhf/add_prod_dhf", params);
};

export const delete_prod_dhf = async (params: any) => {
    return await httpDelete("/trace-api/prod_dhf/delete_prod_dhf", params);
};

export const update_prod_dhf = async (params: any) => {
    return await httpPost("/trace-api/prod_dhf/update_prod_dhf", params);
};

export const list_prod_dhf = async (params: any) => {
    return await httpGet("/trace-api/prod_dhf/list_prod_dhf", params);
};

export const get_prod_dhf = async (params: any) => {
    return await httpGet("/trace-api/prod_dhf/get_prod_dhf", params);
};

export const export_prod_dhfs = async (params: any) => {
    return await httpGet("/trace-api/prod_dhf/export_prod_dhfs", params);
};

export const import_prod_dhfs = async (params: any) => {
    return await httpPost("/trace-api/prod_dhf/import_prod_dhfs", params2form(params));
};

export const delete_prod_dhfs = async (params: any) => {
    return await httpPost("/trace-api/prod_dhf/delete_prod_dhfs", params);
};
