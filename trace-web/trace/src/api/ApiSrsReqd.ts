import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_srs_reqd = async (params: any) => {
    return await httpPost("/trace-api/srs_reqd/add_srs_reqd", params);
};

export const update_srs_reqd = async (params: any) => {
    return await httpPost("/trace-api/srs_reqd/update_srs_reqd", params);
};

export const list_srs_reqd = async (params: any) => {
    return await httpGet("/trace-api/srs_reqd/list_srs_reqd", params);
};

export const get_srs_reqd = async (params: any) => {
    return await httpGet("/trace-api/srs_reqd/get_srs_reqd", params);
};

export const delete_srs_reqd = async (params: any) => {
    return await httpDelete("/trace-api/srs_reqd/delete_srs_reqd", params);
};