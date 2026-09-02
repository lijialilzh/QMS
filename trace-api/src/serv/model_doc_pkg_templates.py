# 模型文件封装需求/封装记录默认内容。详见 docs/function_docs/99_模型文件管理.md。

PKG_REQ_TYPES = ("md_015_01", "md_015_02")
PKG_REC_TYPES = ("md_016",)
PKG_SUBMIT_TYPES = ("md_018",)
PKG_DOC_TYPES = PKG_REQ_TYPES + PKG_REC_TYPES + PKG_SUBMIT_TYPES

PKG_DEFAULTS = {
    "md_015_01": {
        "model_func": "肺栓塞分割",
        "param_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E8%82%BA%E6%A0%93%E5%A1%9E%E5%88%86%E5%89%B2/model&fileid=171578",
        "consistency_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E8%82%BA%E6%A0%93%E5%A1%9E%E5%88%86%E5%89%B2/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C&fileid=171580",
        "code_url": "http://172.16.6.3:8081/model/pe/pe-segmetation",
        "submitter_sign": "",
        "auditor_sign": "",
    },
    "md_015_02": {
        "model_func": "肺叶分割",
        "param_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E8%82%BA%E5%8F%B6%E5%88%86%E5%89%B2/model&fileid=171570",
        "consistency_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E8%82%BA%E5%8F%B6%E5%88%86%E5%89%B2/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C&fileid=171572",
        "code_url": "http://172.16.6.3:8081/model/pe/lobe_segmentation",
        "submitter_sign": "",
        "auditor_sign": "",
    },
    "md_016": {
        "model_func": "肺栓塞分割，肺叶分割，气管分割，血管分割",
        "pack_code_url": "http://172.16.6.3:8081/model/pe/pe_engine",
        "param_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E5%B7%A5%E7%A8%8B%E5%B0%81%E8%A3%85&fileid=171332",
        "consistency_data_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE&fileid=171638",
        "consistency_result_url": "http://172.16.6.3:8089/apps/files/?dir=/Model_name/PECN3/%E5%B7%A5%E7%A8%8B%E5%B0%81%E8%A3%85/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E7%BB%93%E6%9E%9C&fileid=171547",
        "conclusion": "封装模型已验收通过。",
        "packer_sign": "",
        "auditor_sign": "",
    },
    "md_018": {
        "author": "刘恩佑",
        "write_date": "2023.03.23",
        "auditor": "张欢",
        "model_func": "肺血管分割，肺叶分割，支气管分割，肺栓塞分割",
        "submit_model": "pulmonaryembolism_ctpa_m4.9.2.tar",
        "test_conclusion": "内部测试符合《模型需求规格说明》的性能指标",
        "code_url": "http://172.16.3.26:8081/model/pe/pe_engine",
        "param_url": "http://172.16.3.26:8089/apps/files/?dir=/Model_name/PECN3/%E5%B7%A5%E7%A8%8B%E5%B0%81%E8%A3%85&fileid=171332",
        "consistency_data_url": "http://172.16.3.26:8089/apps/files/?dir=/Model_name/AOCN3/%E5%B7%A5%E7%A8%8B%E5%B0%81%E8%A3%85/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE&fileid=158167",
        "consistency_result_url": "http://172.16.3.26:8089/apps/files/?dir=/Model_name/PECN3/%E4%B8%80%E8%87%B4%E6%80%A7%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE&fileid=171638",
        "author_sign": "",
        "auditor_sign": "",
        "approver_sign": "",
    },
}
