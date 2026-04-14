import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const login = async (params: any) => {
    return await httpPost("/trace-api/user/login", params);
};

export const logout = async () => {
    return await httpGet("/trace-api/user/logout");
};

export const current_user = async () => {
    return await httpGet("/trace-api/user/current_user");
};

export const update_pwd = async (params: any) => {
    return await httpPost("/trace-api/user/update_pwd", params);
};


export const add_user = async (params: any) => {
    return await httpPost("/trace-api/user/add_user", params);
};

export const delete_user = async (params: any) => {
    return await httpDelete("/trace-api/user/delete_user", params);
};

export const update_user = async (params: any) => {
    return await httpPost("/trace-api/user/update_user", params);
};

export const reset_pwd = async (params: any) => {
    return await httpGet("/trace-api/user/reset_pwd", params);
};

export const list_user = async (params: any) => {
    return await httpGet("/trace-api/user/list_user", params);
};

export const get_user = async (params: any) => {
    return await httpGet("/trace-api/user/get_user", params);
};
