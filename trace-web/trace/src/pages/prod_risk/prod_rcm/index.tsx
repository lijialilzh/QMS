import * as Api from "@/api/ApiProdRcm";
import ProdRiskProductList from "../ProdRiskProductList";
import EditDlg from "./EditDlg";
import ProdRcmDetail from "./ProdRcmDetail";

export default () => (
    <ProdRiskProductList
        listApi={Api.list_prod_rcm}
        deleteApi={Api.delete_prod_rcms}
        addItemsApi={Api.add_prod_rcms}
        idsParam="rcm_ids"
        selectEmptyMsg="请选择HAZ!"
        MasterPicker={EditDlg}
        Detail={ProdRcmDetail}
        basePath="/prod_rcms"
        addTitle="新增产品RCM"
        hint="选择产品及完整版本后，在下方主数据中全选或勾选 RCM，确定即添加到该产品。"
        countLabel="RCM条数"
        itemLabel="RCM"
    />
);
