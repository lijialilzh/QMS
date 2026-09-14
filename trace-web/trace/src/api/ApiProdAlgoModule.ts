import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_algo_module = async (params: any) => {
    return await httpPost("/trace-api/prod_algo_module/add_prod_algo_module", params);
};

export const update_prod_algo_module = async (params: any) => {
    return await httpPost("/trace-api/prod_algo_module/update_prod_algo_module", params);
};

export const delete_prod_algo_modules = async (params: any) => {
    return await httpDelete("/trace-api/prod_algo_module/delete_prod_algo_modules", params);
};

export const list_prod_algo_module = async (params: any) => {
    return await httpGet("/trace-api/prod_algo_module/list_prod_algo_module", params);
};
