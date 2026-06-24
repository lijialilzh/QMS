import { httpPost, httpGet, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const get_prod_runtime_env = async (params: any) => {
    return await httpGet("/trace-api/prod_runtime_env/get_prod_runtime_env", params);
};

export const save_prod_runtime_env = async (params: any) => {
    return await httpPost("/trace-api/prod_runtime_env/save_prod_runtime_env", params);
};
