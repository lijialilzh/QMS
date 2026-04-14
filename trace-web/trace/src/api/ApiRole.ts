import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_role = async (params: any) => {
    return await httpPost("/trace-api/role/add_role", params);
};

export const delete_role = async (params: any) => {
    return await httpDelete("/trace-api/role/delete_role", params);
};

export const update_role = async (params: any) => {
    return await httpPost("/trace-api/role/update_role", params);
};

export const list_role = async (params: any) => {
    return await httpGet("/trace-api/role/list_role", params);
};

export const get_role = async (params: any) => {
    return await httpGet("/trace-api/role/get_role", params);
};
