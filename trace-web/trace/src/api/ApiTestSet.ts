import { httpPost, httpGet, httpDelete, C_OK as _C_OK, params2form } from "./http";

export const C_OK = _C_OK;

export const add_test_set = async (params: any) => {
    return await httpPost("/trace-api/test_set/add_test_set", params2form(params));
};

export const delete_test_set = async (params: any) => {
    return await httpDelete("/trace-api/test_set/delete_test_set", params);
};

export const update_test_set = async (params: any) => {
    return await httpPost("/trace-api/test_set/update_test_set", params2form(params));
};

export const list_test_set = async (params: any) => {
    return await httpGet("/trace-api/test_set/list_test_set", params);
};

export const get_test_set = async (params: any) => {
    return await httpGet("/trace-api/test_set/get_test_set", params);
};
