import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_prod_hospital = async (params: any) => {
    return await httpPost("/trace-api/prod_hospital/add_prod_hospital", params);
};

export const update_prod_hospital = async (params: any) => {
    return await httpPost("/trace-api/prod_hospital/update_prod_hospital", params);
};

export const delete_prod_hospitals = async (params: any) => {
    return await httpDelete("/trace-api/prod_hospital/delete_prod_hospitals", params);
};

export const list_prod_hospital = async (params: any) => {
    return await httpGet("/trace-api/prod_hospital/list_prod_hospital", params);
};
