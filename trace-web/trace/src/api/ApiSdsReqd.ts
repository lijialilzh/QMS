import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;


export const update_sds_reqd = async (params: any) => {
    return await httpPost("/trace-api/sds_reqd/update_sds_reqd", params2form(params));
};

export const delete_sds_logic = async (params: any) => {
    return await httpDelete("/trace-api/sds_reqd/delete_sds_logic", params);
};

export const list_sds_reqd = async (params: any) => {
    return await httpGet("/trace-api/sds_reqd/list_sds_reqd", params);
};

export const get_sds_reqd = async (params: any) => {
    return await httpGet("/trace-api/sds_reqd/get_sds_reqd", params);
};