import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "@/api/http";

export const C_OK = _C_OK;

export const add_ecr = async (params: any) => {
    return await httpPost("/trace-api/ecr/add_ecr", params);
};

export const update_ecr = async (params: any) => {
    return await httpPost("/trace-api/ecr/update_ecr", params);
};

export const delete_ecr = async (params: any) => {
    return await httpDelete("/trace-api/ecr/delete_ecr", params);
};

export const list_ecr = async (params: any) => {
    return await httpGet("/trace-api/ecr/list_ecr", params);
};
