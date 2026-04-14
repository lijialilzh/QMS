import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_test_case = async (params: any) => {
    return await httpPost("/trace-api/test_case/add_test_case", params);
};

export const delete_test_case = async (params: any) => {
    return await httpDelete("/trace-api/test_case/delete_test_case", params);
};

export const update_test_case = async (params: any) => {
    return await httpPost("/trace-api/test_case/update_test_case", params);
};

export const list_test_case = async (params: any) => {
    return await httpGet("/trace-api/test_case/list_test_case", params);
};

export const get_test_case = async (params: any) => {
    return await httpGet("/trace-api/test_case/get_test_case", params);
};

export const export_test_cases = async (params: any) => {
    return await httpGet("/trace-api/test_case/export_test_cases", params);
};
