import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_srs_req = async (params: any) => {
    return await httpPost("/trace-api/srs_req/add_srs_req", params);
};

export const delete_srs_req = async (params: any) => {
    return await httpDelete("/trace-api/srs_req/delete_srs_req", params);
};

export const update_srs_req = async (params: any) => {
    return await httpPost("/trace-api/srs_req/update_srs_req", params);
};

export const list_srs_req = async (params: any) => {
    return await httpGet("/trace-api/srs_req/list_srs_req", params);
};
