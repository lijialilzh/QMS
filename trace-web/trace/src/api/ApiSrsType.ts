import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_srs_type = async (params: any) => {
    return await httpPost("/trace-api/srs_type/add_srs_type", params);
};

export const delete_srs_type = async (params: any) => {
    return await httpDelete("/trace-api/srs_type/delete_srs_type", params);
};

export const update_srs_type = async (params: any) => {
    return await httpPost("/trace-api/srs_type/update_srs_type", params);
};

export const list_srs_type = async (params: any) => {
    return await httpGet("/trace-api/srs_type/list_srs_type", params);
};