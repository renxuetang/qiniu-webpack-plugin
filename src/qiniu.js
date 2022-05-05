// eslint-disable-next-line
/* eslint class-methods-use-this: ["error", { "exceptMethods": ["getExtra"] }] */
/* eslint no-console: ["error", { allow: ["log", "error"] }] */

const qiniu = require('qiniu');

class Qiniu {
  constructor({
    bucket, accessKey, secretKey, domain, options,
  }) {
    this.domain = domain;
    this.bucket = bucket;
    this.config = new qiniu.conf.Config();
    this.mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    this.bucketManager = new qiniu.rs.BucketManager(this.mac, this.config);
    // @param defOptions 列举操作的可选参数
    // prefix    列举的文件前缀
    // marker    上一次列举返回的位置标记，作为本次列举的起点信息
    // limit     每次返回的最大列举文件数量
    // delimiter 指定目录分隔符
    // replacePrefix 替换前缀字符串
    // fromBucket 从...空间名
    // toBucket 到空间名
    this.options = {
      // limit: 100,
      // prefix: 'static/',
      ...options,
    };
  }

  getToken(options) {
    // eslint-disable-next-line
    const data  = Object.assign({
      scope: this.bucket,
    }, options);

    const putPolicy = new qiniu.rs.PutPolicy(data);
    return putPolicy.uploadToken(this.mac);
  }

  getExtra(options = {}) {
    const extra = new qiniu.form_up.PutExtra();

    Object.keys(options || {}).forEach((key) => {
      extra[key] = options[key];
    });

    return extra;
  }

  putFile(remotePath, localFilePath, options = {}) {
    const extra = this.getExtra(options);
    const token = this.getToken({
      scope: `${this.bucket}:${remotePath}`,
    });

    const formUploader = new qiniu.form_up.FormUploader(this.config);

    return new Promise((resolve, reject) => {
      formUploader.putFile(token, remotePath, localFilePath, extra, (err, resBody, resInfo) => {
        if (err) {
          return reject(err);
        }

        if (resInfo.statusCode === 200) {
          return resolve(resBody);
        }
        return reject(new Error({
          code: resInfo.statusCode,
          data: resBody,
        }));
      });
    });
  }


  put(remotePath, text, options = {}) {
    const extra = this.getExtra(options);
    const token = this.getToken({
      scope: `${this.bucket}:${remotePath}`,
    });

    const formUploader = new qiniu.form_up.FormUploader(this.config);

    return new Promise((resolve, reject) => {
      formUploader.put(token, remotePath, text, extra, (err, resBody, resInfo) => {
        if (err) {
          return reject(err);
        }

        if (resInfo.statusCode === 200) {
          return resolve(resBody);
        }
        return reject(new Error({
          code: resInfo.statusCode,
          data: resBody,
        }));
      });
    });
  }

  batchDelete(keys = []) {
    const copyKey = keys.map(key => qiniu.rs.deleteOp(this.bucket, key));

    return new Promise((resolve, reject) => {
      this.bucketManager.batch(copyKey, (err, resBody, resInfo) => {
        if (err) {
          return reject(err);
        }
        if (resInfo.statusCode === 200 || resInfo.statusCode === 298) {
          return resolve({
            code: resInfo.statusCode,
            data: resBody,
          });
        }
        return reject(new Error({
          code: resInfo.statusCode,
          data: resBody,
        }));
      });
    });
  }

  getPublicDownloadUrl(remotePath) {
    const publicDownloadUrl = this.bucketManager.publicDownloadUrl(this.domain, remotePath);
    return publicDownloadUrl;
  }

  // 批量删除文件方法
  handlerDeleteList(keys) {
    return new Promise((resolve, reject) => {
    // 批量操作删除资源
      const keysCopy = keys.map(key => qiniu.rs.deleteOp(this.bucket, key));

      this.bucketManager.batch(keysCopy, (err, respBody, respInfo) => {
        if (err) {
          console.error(err);
          return reject(err);
        }

        if (respInfo.statusCode === 400) {
          return resolve({
            code: respInfo.statusCode,
            data: respBody,
          });
        }

        if (respInfo.statusCode === 200 || respInfo.statusCode === 298) {
          return resolve({
            code: respInfo.statusCode,
            data: respBody,
          });
        }

        return reject(new Error({
          code: respInfo.statusCode,
          data: respBody,
        }));
      });
    });
  }

  // 批量移动文件方法
  handlerMoveList(keys, {
    replacePrefix, fromBucket, toBucket, prefix
  }) {
    return new Promise((resolve, reject) => {
      const srcBucket = fromBucket || this.bucket;
      const destBucket = toBucket || srcBucket;

      // 每个operations的数量不可以超过1000个，如果总数量超过1000，需要分批发送
      const moveOperations = keys.map((key) => {
        const regExp = new RegExp(`(${prefix})`, 'gi');
        const newPrefix = key.replace(regExp, replacePrefix);

        return qiniu.rs.moveOp(srcBucket, key, destBucket, newPrefix);
      });

      this.bucketManager.batch(moveOperations, (err, respBody, respInfo) => {
        if (err) {
          console.error(err);
          return reject(err);
        }

        // 200 is success, 298 is part success
        if (parseInt(respInfo.statusCode / 100, 10) === 2) {
          const faileds = respBody.filter(item => item.code !== 200);

          if (faileds.length > 0) {
            console.error(`${faileds.length}个文件移动失败！`);

            return reject(new Error({
              status: respInfo.statusCode,
              data: faileds,
            }));
          }
          console.log(`${respBody.length}个文件移动成功！`);
          return resolve({
            code: respInfo.statusCode,
            data: respBody,
          });
        }
        console.error('移动失败！');

        return reject(new Error({
          code: respInfo.deleteusCode,
          status: respInfo.statusCode,
          data: respBody,
        }));
      });
    });
  }

  // 批量复制文件方法
  handlerCopyList(keys, {
    replacePrefix, fromBucket, toBucket, prefix
  }) {
    return new Promise((resolve, reject) => {
      const srcBucket = fromBucket || this.bucket;
      const destBucket = toBucket || srcBucket;

      // 每个operations的数量不可以超过1000个，如果总数量超过1000，需要分批发送
      const copyOperations = keys.map((key) => {
        const regExp = new RegExp(`(${prefix})`, 'gi');
        const newPrefix = key.replace(regExp, replacePrefix);
        return qiniu.rs.copyOp(srcBucket, key, destBucket, newPrefix);
      });

      this.bucketManager.batch(copyOperations, (err, respBody, respInfo) => {
        if (err) {
          console.error(err);
          return reject(err);
        }

        // 200 is success, 298 is part success
        if (parseInt(respInfo.statusCode / 100, 10) === 2) {
          const faileds = respBody.filter(item => item.code !== 200);

          if (faileds.length > 0) {
            console.error(`${faileds.length}个文件复制失败！`);
            console.error(JSON.stringify({
              status: respInfo.statusCode,
              data: faileds,
            }))

            return reject(new Error({
              status: respInfo.statusCode,
              data: faileds,
            }));
          }
          console.log(`${respBody.length}个文件复制成功！`);
          return resolve({
            code: respInfo.statusCode,
            data: respBody,
          });
        }
        console.error('复制失败！');

        return reject(new Error({
          code: respInfo.deleteusCode,
          status: respInfo.statusCode,
          data: respBody,
        }));
      });
    });
  }

  // 获取资源列举数据
  listPrefix(option = {}) {
    return new Promise((resolve, reject) => {
      this.bucketManager.listPrefix(this.bucket,
        { ...this.options, ...option },
        (err, respBody, respInfo) => {
          if (err) {
            console.error(err);
            return reject(err);
          }

          if (respInfo.statusCode === 200) {
            return resolve({
              ...respInfo,
              ...respBody,
              code: respInfo.statusCode,
            });
          }
          console.error(respInfo.statusCode);
          console.error(respBody);
          return reject(new Error({
            status: respInfo.statusCode,
            data: respBody,
          }));
        });
    });
  }

  // 删除文件（包含批量）
  deleteList(options = this.options) {
    return new Promise(async (resolve, reject) => {
      const prefixList = options => this.listPrefix(options)
        .then((res) => {
          const { marker, items = [] } = res;
          const keys = items.map(item => item.key);

          if (!keys.length) return res;

          return this.handlerDeleteList(keys)
            .then(() => {
              if (marker) {
                return this.deleteList({
                  ...options,
                  marker,
                });
              } else {
                console.log('删除成功！');
                return res;
              }
            })
            .catch((error) => {
              console.error(error);
              console.error('删除失败！');
              return error;
            });
        });

      const deleteResult = await prefixList(options);

      if (deleteResult.code === 200) {
        resolve(deleteResult)
      } else {
        reject(deleteResult)
      }
    });

  }

  // 移动文件（包含批量）
  moveList(options = {}) {
    return new Promise(async (resolve, reject) => {
      const prefixList = options => this.listPrefix(options)
        .then((res) => {
          const { marker, items = [] } = res;
          const keys = items.map(item => item.key);

          if (keys.length <= 0) {
            return res;
          } else {
            return this.handlerMoveList(keys, {
            ...this.options,
              ...options,
            })
              .then((result) => {
                console.log(marker);
                if (marker) {
                  return prefixList({
                    ...options,
                    marker,
                  });
                }
                console.log('移动结束！');
                return result;
              })
              .catch((error) => {
                console.error('移动失败！');
                console.error(JSON.stringify(error));
                return error;
              });
          }
        });

        const moveResult = await prefixList(options);

        if (moveResult.code === 200) {
          resolve(moveResult)
        } else {
          reject(moveResult)
        }
      });
  }

  // 复制文件（包含批量）
  copyList(options = {}) {
    return new Promise(async (resolve, reject) => {
      const prefixList = options => this.listPrefix(options)
      .then((res) => {
        const { marker, items = [] } = res;
        const keys = items.map(item => item.key);

        if (keys.length <= 0) {
          return res;
        } else {
          return this.handlerCopyList(keys, {
           ...this.options,
            ...options,
          })
            .then((result) => {
              console.log(marker);
              if (marker) {
                return prefixList({
                  ...options,
                  marker,
                });
              }
              console.log('复制结束！');
              return result;
            })
            .catch((error) => {
              console.error('复制失败！');
              console.error(JSON.stringify(error));
              return error;
            });
        }
      });

      const copyResult = await prefixList(options);

      if (copyResult.code === 200) {
        resolve(copyResult)
      } else {
        reject(copyResult)
      }
    });
  }
}

module.exports = Qiniu;
