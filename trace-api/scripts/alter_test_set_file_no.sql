-- 测试集支持同阶段多文件：增加 file_no / file_name，唯一键改为 (product_id, file_no, file_name)
-- PostgreSQL。执行前请备份。

ALTER TABLE test_set ADD COLUMN IF NOT EXISTS file_no VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE test_set ADD COLUMN IF NOT EXISTS file_name VARCHAR(256) NOT NULL DEFAULT '';

-- 必须删除旧唯一 (product_id, stage)，否则同阶段无法再传 A1/A2
ALTER TABLE test_set DROP CONSTRAINT IF EXISTS test_set_product_id_stage_key;
ALTER TABLE test_set DROP CONSTRAINT IF EXISTS uq_test_set_product_id_stage;

-- 旧数据无文件名时用 legacy-{id} 占位，避免空串无法建唯一索引
UPDATE test_set SET file_no = 'legacy-' || id::text
WHERE COALESCE(TRIM(file_no), '') = '';

ALTER TABLE test_set DROP CONSTRAINT IF EXISTS uq_test_set_product_file;
ALTER TABLE test_set ADD CONSTRAINT uq_test_set_product_file UNIQUE (product_id, file_no, file_name);
