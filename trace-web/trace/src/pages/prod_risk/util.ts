import { message } from "antd";

import * as ApiProduct from "@/api/ApiProduct";
import * as ApiProdRcm from "@/api/ApiProdRcm";

export const doSearchProducts = (data: any, dispatch: any) => {
    if (data.products.length === 0) {
        dispatch({ loadingProducts: true });
        ApiProduct.list_product({ page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ loadingProducts: false, products: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingProducts: false });
            }
        });
    }
};

export const doSearchRcms = (prod_id: any, data: any, dispatch: any) => {
    if (data.rcms.length === 0) {
        dispatch({ loadingRcms: true });
        ApiProdRcm.list_prod_rcm({ prod_id, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProdRcm.C_OK) {
                dispatch({ loadingRcms: false, rcms: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingRcms: false });
            }
        });
    }
};
