import { httpGet, httpPost, httpDelete } from "./http";
import { C_OK } from "./ApiUser";

export { C_OK };

export const list_print_cfg = async (params: any) => {
    return await httpGet("/trace-api/print_cfg/list_print_cfg", params);
};

export const add_print_cfg = async (params: any) => {
    return await httpPost("/trace-api/print_cfg/add_print_cfg", params);
};

export const update_print_cfg = async (params: any) => {
    return await httpPost("/trace-api/print_cfg/update_print_cfg", params);
};

export const delete_print_cfg = async (params: any) => {
    return await httpDelete("/trace-api/print_cfg/delete_print_cfg", params);
};

export const set_default_print_cfg = async (params: any) => {
    return await httpPost("/trace-api/print_cfg/set_default_print_cfg", params);
};

export const test_print_conn = async (params: any) => {
    return await httpGet("/trace-api/print_cfg/test_print_conn", params);
};

export const ipp_print_doc = async (params: any) => {
    return await httpGet("/trace-api/print_cfg/ipp_print_doc", params);
};
