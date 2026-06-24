import { httpPost, httpGet, httpDelete, params2form, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const list_timeline = async (params: any) => {
    return await httpGet("/trace-api/project_timeline/list_timeline", params);
};

export const add_timeline_row = async (params: any) => {
    return await httpPost("/trace-api/project_timeline/add_timeline_row", params);
};

export const update_timeline_row = async (params: any) => {
    return await httpPost("/trace-api/project_timeline/update_timeline_row", params);
};

export const delete_timeline_row = async (params: any) => {
    return await httpDelete("/trace-api/project_timeline/delete_timeline_row", params);
};

export const update_timeline_cell = async (params: any) => {
    return await httpPost("/trace-api/project_timeline/update_timeline_cell", params);
};

export const import_timeline = async (params: any) => {
    return await httpPost("/trace-api/project_timeline/import_timeline", params2form(params));
};

export const export_timeline = async (params: any) => {
    return await httpGet("/trace-api/project_timeline/export_timeline", params);
};
