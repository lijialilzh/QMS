import * as Api from "@/api/ApiProdCst";
import ProdRiskProductList from "../ProdRiskProductList";
import EditDlg from "./EditDlg";

export default () => (
    <ProdRiskProductList
        listApi={Api.list_prod_cst}
        deleteApi={Api.delete_prod_csts}
        addItemsApi={Api.add_prod_csts}
        idsParam="cst_ids"
        selectEmptyMsg="请选择HAZ!"
        MasterPicker={EditDlg}
        basePath="/prod_csts"
        addTitle="新增产品THREAT"
        hint="选择产品及完整版本后，在下方主数据中全选或勾选 THREAT，确定即添加到该产品。"
        countLabel="THREAT条数"
        itemLabel="THREAT"
    />
);
