import { httpGet } from "./http";
import { C_OK } from "./ApiUser";

export { C_OK };

// 整合导出预览：按产品聚合所有文档清单
export const list_integrate_docs = async (params: any) => {
    return await httpGet("/trace-api/doc_integrate/list_integrate_docs", params);
};

// 一键打印：返回选中文档的打印URL清单
export const one_click_print_list = async (params: any) => {
    return await httpGet("/trace-api/doc_integrate/one_click_print_list", params);
};

// 整合导出 SSE 进度流 URL（EventSource 用）
export const integrate_export_progress_url = (product_id: number, doc_keys: string, with_sign: boolean = true) => {
    return `/trace-api/doc_integrate/integrate_export_progress?product_id=${product_id}&doc_keys=${encodeURIComponent(doc_keys)}&with_sign=${with_sign}`;
};

// 整合导出下载 URL（按 token 下载 zip）
export const integrate_download_url = (token: string) => {
    return `/trace-api/doc_integrate/integrate_download?token=${token}`;
};

// 旧接口保留兼容
export const integrate_export_url = (product_id: number, doc_keys: string) => {
    return `/trace-api/doc_integrate/integrate_export?product_id=${product_id}&doc_keys=${encodeURIComponent(doc_keys)}`;
};

// 导出记录
export const list_export_records = async (params: any) => {
    return await httpGet("/trace-api/doc_integrate/list_export_records", params);
};

// 打印记录
export const list_print_records = async (params: any) => {
    return await httpGet("/trace-api/doc_integrate/list_print_records", params);
};

// 写入打印记录（一键打印完成后调用）
export const add_print_record = async (params: any) => {
    return await httpPost("/trace-api/doc_integrate/add_print_record", params);
};
