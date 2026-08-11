-- HLD 图片以 data URL 存入 doc_file.file_url，需扩大字段长度
ALTER TABLE doc_file ALTER COLUMN file_url TYPE TEXT;
