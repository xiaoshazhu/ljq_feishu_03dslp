-- 修正已写入数据库的抖店接口分页起始值。
-- 抖店后台接口按 page=0 拉第一页，飞书内部页码仍保持 page_2、page_3 这种 1 起始 token。

UPDATE doudian_interfaces
SET request_config = JSON_SET(request_config, '$.pageStart', 0)
WHERE platform = 'douyin'
  AND JSON_UNQUOTE(JSON_EXTRACT(request_config, '$.pageStart')) = '1';

UPDATE doudian_interfaces
SET request_config = JSON_SET(request_config, '$.requiredParams[0].defaultValue', 0)
WHERE platform = 'douyin'
  AND JSON_UNQUOTE(JSON_EXTRACT(request_config, '$.requiredParams[0].name')) = JSON_UNQUOTE(JSON_EXTRACT(request_config, '$.pageParam'))
  AND JSON_UNQUOTE(JSON_EXTRACT(request_config, '$.requiredParams[0].defaultValue')) = '1';
