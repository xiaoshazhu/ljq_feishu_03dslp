-- 为抖店接口注册表增加本地聚合接口路径。
-- 为空表示直接调用 api_host + api_path；非空表示优先调用本地聚合接口。

ALTER TABLE doudian_interfaces
  ADD COLUMN local_aggregate_path VARCHAR(512) DEFAULT NULL COMMENT '本地聚合接口路径，非空时优先调用本地聚合接口' AFTER api_path;
