import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_project = async (params: any) => {
    return await httpPost("/trace-api/project/add_project", params);
};

export const delete_project = async (params: any) => {
    return await httpDelete("/trace-api/project/delete_project", params);
};

export const update_project = async (params: any) => {
    return await httpPost("/trace-api/project/update_project", params);
};

export const list_project = async (params: any) => {
    return await httpGet("/trace-api/project/list_project", params);
};

export const get_project = async (params: any) => {
    return await httpGet("/trace-api/project/get_project", params);
};
