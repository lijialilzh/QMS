import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_company_info = async (params: any) => {
    return await httpPost("/trace-api/company_info/add_company_info", params);
};

export const delete_company_info = async (params: any) => {
    return await httpDelete("/trace-api/company_info/delete_company_info", params);
};

export const update_company_info = async (params: any) => {
    return await httpPost("/trace-api/company_info/update_company_info", params);
};

export const list_company_info = async (params: any) => {
    return await httpGet("/trace-api/company_info/list_company_info", params);
};

export const get_company_info = async (params: any) => {
    return await httpGet("/trace-api/company_info/get_company_info", params);
};
