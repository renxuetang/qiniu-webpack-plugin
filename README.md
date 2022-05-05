# Qiniu Webpack Plugin [![npm](https://img.shields.io/npm/v/@renxuetang/qiniu-webpack-plugin.svg)](https://www.npmjs.com/package/@renxuetang/qiniu-webpack-plugin)

> 🚀 Webpack 编译后的文件上传到 七牛云存储

## 功能

- 支持并发上传
- 保留上一版本文件
- 智能分析，不重复上传

## 安装

```Bash
npm install @renxuetang/qiniu-webpack-plugin --dev
```


## 使用

**webpack.config.js**

```Javascript
const QiniuWebpackPlugin = require('@renxuetang/qiniu-webpack-plugin');

module.exports = {
  // ... Webpack 相关配置
  plugins: [
    new QiniuWebpackPlugin({
      accessKey: 'qiniu access key', // 必填
      secretKey: 'qiniu secret key', // 必填
      bucket: 'demo', // 必填
      bucketDomain: 'https://xxx.clouddn.com', // 必填
      matchFiles: ['!*.html', '!*.map'],
      uploadPath: '/assets',
      batch: 10,
      deltaUpdate: true,
      options: {
        prefix: 'static/',                // 列举的文件前缀
        replacePrefix: 'backup/static/',  // 替换前缀字符串
        fromBucket: 'demo',               // 从...空间名
        toBucket: 'demo',                 // 到空间名
        marker: null,                     // 上一次列举返回的位置标记，作为本次列举的起点信息
        limit: 1000                       // 每次返回的最大列举文件数量(1 - 1000)
        delimiter: null,                  // 指定目录分隔符
      }
    })
  ]
}
```

**Options**

|Name|Type|Default|Required|Description|
|:--:|:--:|:-----:|:-----:|:----------|
|**[`accessKey`](#)**|`{String}`| | true |七牛 Access Key|
|**[`secretKey`](#)**|`{String}`| | true |七牛 Secret Key|
|**[`bucket`](#)**|`{String}`| | true |七牛 空间名|
|**[`bucketDomain`](#)**|`{String}`| | true |七牛 空间域名|
|**[`matchFiles`](#)**|`{Array[string]}`| ['*'] | false |匹配文件/文件夹，支持 include/exclude|
|**[`uploadPath`](#)**|`{string}`| /webpack_assets | false |上传文件夹名|
|**[`batch`](#)**|`{number}`| 10 | false |同时上传文件数|
|**[`deltaUpdate`](#)**|`{Boolean}`| true | false |是否增量构建|
|**[`options`](#)**|`{Object}`| {} | false |额外参数|

- `bucketDomain` 支持不携带通信协议: `//xxx.clouddn.com`
- `matchFiles` 匹配相关文件或文件夹，详细使用请看: [micromatch](https://github.com/micromatch/micromatch)
  - `!*.html` 不上传文件后缀为 `html` 的文件
  - `!assets/**.map` 不上传 `assets` 文件夹下文件后缀为 `map` 的文件


***



## Special Thanks

- [zzetao](https://github.com/zzetao)



## License

Copyright © 2019, [renxuetang](https://github.com/renxuetang).
Released under the [MIT License](LICENSE).
