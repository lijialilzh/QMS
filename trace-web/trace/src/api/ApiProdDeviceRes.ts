import { httpPost, httpGet, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const get_prod_device_res = async (params: any) => {
    return await httpGet("/trace-api/prod_device_res/get_prod_device_res", params);
};

export const save_prod_device_res = async (params: any) => {
    return await httpPost("/trace-api/prod_device_res/save_prod_device_res", params);
};
