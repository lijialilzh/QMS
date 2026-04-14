import { httpPost, httpGet, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;


export const update_sds_trace = async (params: any) => {
    return await httpPost("/trace-api/sds_trace/update_sds_trace", params);
};

export const list_sds_trace = async (params: any) => {
    return await httpGet("/trace-api/sds_trace/list_sds_trace", params);
};

export const get_sds_trace = async (params: any) => {
    return await httpGet("/trace-api/sds_trace/get_sds_trace", params);
};