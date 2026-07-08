import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_dat_doc = async (params: any) => {
    return await httpPost("/trace-api/dat_doc/add_dat_doc", params);
};

export const duplicate_dat_doc = async (params: any) => {
    return await httpGet("/trace-api/dat_doc/duplicate_dat_doc", params);
};

export const update_dat_doc = async (params: any) => {
    return await httpPost("/trace-api/dat_doc/update_dat_doc", params);
};

export const delete_dat_doc = async (params: any) => {
    return await httpDelete("/trace-api/dat_doc/delete_dat_doc", params);
};

export const list_dat_doc = async (params: any) => {
    return await httpGet("/trace-api/dat_doc/list_dat_doc", params);
};

export const get_dat_doc = async (params: any) => {
    return await httpGet("/trace-api/dat_doc/get_dat_doc", params);
};

export const export_dat_doc = async (params: any) => {
    return await httpGet("/trace-api/dat_doc/export_dat_doc", params);
};
