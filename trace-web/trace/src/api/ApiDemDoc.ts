import { httpDelete, httpGet, httpPost, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_dem_doc = async (params: any) => {
    return await httpPost("/trace-api/dem_doc/add_dem_doc", params);
};

export const duplicate_dem_doc = async (params: any) => {
    return await httpGet("/trace-api/dem_doc/duplicate_dem_doc", params);
};

export const update_dem_doc = async (params: any) => {
    return await httpPost("/trace-api/dem_doc/update_dem_doc", params);
};

export const delete_dem_doc = async (params: any) => {
    return await httpDelete("/trace-api/dem_doc/delete_dem_doc", params);
};

export const list_dem_doc = async (params: any) => {
    return await httpGet("/trace-api/dem_doc/list_dem_doc", params);
};

export const get_dem_doc = async (params: any) => {
    return await httpGet("/trace-api/dem_doc/get_dem_doc", params);
};

export const export_dem_doc = async (params: any) => {
    return await httpGet("/trace-api/dem_doc/export_dem_doc", params);
};
