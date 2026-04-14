import { httpPost, httpGet, httpDelete, C_OK as _C_OK } from "./http";

export const C_OK = _C_OK;

export const add_product = async (params: any) => {
    return await httpPost("/trace-api/product/add_product", params);
};

export const delete_product = async (params: any) => {
    return await httpDelete("/trace-api/product/delete_product", params);
};

export const update_product = async (params: any) => {
    return await httpPost("/trace-api/product/update_product", params);
};

export const list_product = async (params: any) => {
    return await httpGet("/trace-api/product/list_product", params);
};

export const get_product = async (params: any) => {
    return await httpGet("/trace-api/product/get_product", params);
};

export const export_products = async (params: any) => {
    return await httpGet("/trace-api/product/export_products", params);
};

export const export_product_trace = async (params: any) => {
    return await httpGet("/trace-api/product/export_product_trace", params);
};
