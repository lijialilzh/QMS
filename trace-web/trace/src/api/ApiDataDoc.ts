import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_data_doc = async (params: any) => {
    return await httpPost("/trace-api/data_doc/add_data_doc", params);
};

export const duplicate_data_doc = async (params: any) => {
    return await httpGet("/trace-api/data_doc/duplicate_data_doc", params);
};

export const update_data_doc = async (params: any) => {
    return await httpPost("/trace-api/data_doc/update_data_doc", params);
};

export const delete_data_doc = async (params: any) => {
    return await httpDelete("/trace-api/data_doc/delete_data_doc", params);
};

export const list_data_doc = async (params: any) => {
    return await httpGet("/trace-api/data_doc/list_data_doc", params);
};

export const get_data_doc = async (params: any) => {
    return await httpGet("/trace-api/data_doc/get_data_doc", params);
};

export const export_data_doc = async (params: any) => {
    return await httpGet("/trace-api/data_doc/export_data_doc", params);
};

export const import_stats_excel = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return await httpPost("/trace-api/data_doc/import_stats_excel", form);
};
